package com.example.blog.service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.example.blog.domain.Session;
import com.example.blog.domain.User;
import com.example.blog.repository.SessionStore;
import com.example.blog.repository.UserRepository;
import com.example.blog.repository.LoginLogRepository;
import com.example.blog.domain.LoginLog;
import com.example.blog.security.CredentialValidator;
import com.example.blog.security.CredentialValidator.LoginInput;
import com.example.blog.security.CredentialValidator.RegisterInput;
import com.example.blog.foundation.security.RateLimiter;
import com.example.blog.security.PasswordHasher;
import com.example.blog.web.ApiException;
import com.example.blog.web.dto.LoginRequest;
import com.example.blog.web.dto.RegisterRequest;

/**
 * 认证领域逻辑。与阶段一 Node 版保持相同的校验顺序与错误码，
 * 存储层换成 MySQL（用户）与 Redis（会话），API 契约不变。
 *
 * 入参校验统一委托 security/CredentialValidator（长度 8~16、类型/控制字符、
 * SQL 注入特征拒绝），本类只负责哈希、持久化与会话生命周期。
 */
@Service
public class AuthService {

    private final UserRepository users;
    private final SessionStore sessions;
    private final PasswordHasher hasher;
    private final RateLimiter rateLimiter;
    private final LoginLogRepository loginLogs;
    private final int maxFails;
    private final long lockMillis;
    private final int registerLimitIp;
    private final int registerLimitPhone;
    private final java.time.Duration registerWindow;
    /** 账号不存在时仍执行一次 PBKDF2，缓解时序侧信道枚举 */
    private final String dummyHash;

    public AuthService(
            UserRepository users,
            SessionStore sessions,
            PasswordHasher hasher,
            RateLimiter rateLimiter,
            LoginLogRepository loginLogs,
            @Value("${blog.security.login-max-fails:5}") int maxFails,
            @Value("${blog.security.lock-seconds:60}") long lockSeconds,
            @Value("${blog.security.register-limit-ip:200}") int registerLimitIp,
            @Value("${blog.security.register-limit-phone:5}") int registerLimitPhone,
            @Value("${blog.security.register-window-seconds:600}") long registerWindowSeconds) {
        this.users = users;
        this.sessions = sessions;
        this.hasher = hasher;
        this.rateLimiter = rateLimiter;
        this.loginLogs = loginLogs;
        this.maxFails = maxFails;
        this.lockMillis = lockSeconds * 1000L;
        this.registerLimitIp = registerLimitIp;
        this.registerLimitPhone = registerLimitPhone;
        this.registerWindow = java.time.Duration.ofSeconds(registerWindowSeconds);
        this.dummyHash = hasher.hash("timing-safe-dummy-password");
    }

    public Map<String, Object> register(RegisterRequest request, String clientKey) {
        RegisterInput in = CredentialValidator.validateRegister(request);
        String phone = in.phone();
        String nickname = in.nickname();
        String password = in.password();

        // F0-7 注册风控：按手机号 + 客户端来源双重限流。
        // 顺序放在校验之后、入库之前，既不影响既有响应结构，也避免把明显非法的请求计入配额。
        String client = (clientKey == null || clientKey.isBlank()) ? "unknown" : clientKey;
        rateLimiter.requireAllowed("reg:phone:" + phone,
                registerLimitPhone, registerWindow, "该手机号注册过于频繁，请稍后再试");
        rateLimiter.requireAllowed("reg:ip:" + client,
                registerLimitIp, registerWindow, "注册过于频繁，请稍后再试");

        // 哈希在唯一性检查之前完成，DB 唯一索引负责并发去重
        String passwordHash = hasher.hash(password);
        User user = new User(
                UUID.randomUUID().toString(), phone, nickname, passwordHash,
                System.currentTimeMillis(), null, 0, 0L);
        try {
            users.insert(user);
        } catch (org.springframework.dao.DuplicateKeyException ex) {
            throw new ApiException(409, "该手机号已注册，请直接登录");
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", user.toPublic());
        return out;
    }

    public Map<String, Object> login(LoginRequest request, String userAgent, String ip) {
        LoginInput in = CredentialValidator.validateLogin(request);
        String phone = in.phone();
        String password = in.password();
        boolean remember = request.remember() != null && request.remember();

        Optional<User> found = users.findByPhone(phone);
        String hashToVerify = found.map(User::passwordHash).orElse(dummyHash);
        boolean passwordOk = hasher.verify(password, hashToVerify);
        ApiException generic = new ApiException(401, "手机号或密码错误");

        if (!passwordOk) {
            found.ifPresent(user -> {
                int fails = user.loginFails() + 1;
                long lockedUntil = fails >= maxFails
                        ? System.currentTimeMillis() + lockMillis
                        : user.lockedUntilMs();
                users.recordLoginFailure(user.id(), fails, lockedUntil);
                recordLoginLog(user.id(), phone, ip, userAgent, "fail", "密码错误");
            });
            if (found.isEmpty()) {
                recordLoginLog(null, phone, ip, userAgent, "fail", "账号不存在");
            }
            throw generic;
        }
        if (found.isEmpty()) throw generic;

        User user = found.get();
        // F0 注销账号不可再次登录
        Optional<Long> disabled = users.findDisabledAtMs(user.id());
        if (disabled.isPresent()) {
            recordLoginLog(user.id(), phone, ip, userAgent, "fail", "账号已注销");
            throw new ApiException(403, "该账号已注销，无法登录");
        }
        long now = System.currentTimeMillis();
        if (user.lockedUntilMs() > now) {
            long seconds = (user.lockedUntilMs() - now + 999) / 1000;
            recordLoginLog(user.id(), phone, ip, userAgent, "fail", "锁定中");
            throw new ApiException(423, "登录失败次数过多，请于 " + seconds + " 秒后重试");
        }

        users.markLoginSuccess(user.id(), now);
        Session session = sessions.save(user.id(), userAgent, ip, remember);
        User current = users.findById(user.id()).orElse(user);
        recordLoginLog(user.id(), phone, ip, userAgent, "success", null);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("token", session.token());
        out.put("expiresAt", session.expiresAt().toString());
        out.put("remembered", remember);
        out.put("user", current.toPublic());
        return out;
    }

    private void recordLoginLog(String userId, String phone, String ip, String ua, String result, String reason) {
        try {
            loginLogs.insert(new LoginLog(loginLogs.nextId(), userId, phone,
                    ip == null ? "" : ip, ua == null ? "" : ua, result,
                    reason == null ? "" : reason, System.currentTimeMillis()));
        } catch (Exception ex) {
            // 审计日志写入失败不阻断登录主流程
        }
    }

    public Map<String, Object> me(String token) {
        if (token == null || token.isBlank()) {
            throw new ApiException(401, "登录状态无效或已过期，请重新登录");
        }
        Session session = sessions.find(token)
                .orElseThrow(() -> new ApiException(401, "登录状态无效或已过期，请重新登录"));
        User user = users.findById(session.userId())
                .orElseThrow(() -> new ApiException(401, "登录状态无效或已过期，请重新登录"));

        Map<String, Object> sessionView = new LinkedHashMap<>();
        sessionView.put("createdAt", session.createdAt().toString());
        sessionView.put("expiresAt", session.expiresAt().toString());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", user.toPublic());
        out.put("session", sessionView);
        return out;
    }

    public void logout(String token) {
        sessions.delete(token);
    }

    public Map<String, Object> health() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("service", "blog-auth-spring-api");
        out.put("storage", "mysql+redis");
        out.put("time", Instant.now().toString());
        out.put("userCount", users.count());
        out.put("activeSessionCount", sessions.countActive());
        return out;
    }
}
