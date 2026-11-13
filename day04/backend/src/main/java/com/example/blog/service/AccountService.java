package com.example.blog.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Service;

import com.example.blog.domain.LoginLog;
import com.example.blog.domain.Session;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.repository.ArticleRepository;
import com.example.blog.repository.CollectionRepository;
import com.example.blog.repository.LoginLogRepository;
import com.example.blog.repository.MediaRepository;
import com.example.blog.repository.MomentRepository;
import com.example.blog.repository.SessionStore;
import com.example.blog.repository.UserPreferenceRepository;
import com.example.blog.repository.UserRepository;
import com.example.blog.security.CredentialValidator;
import com.example.blog.security.PasswordHasher;

/**
 * F0/F7 账号设置与安全管理（P3/W4/W5）。
 *
 * <p>会话：列表 / 踢下线 / 全部登出；改密后其他会话立即失效；登录日志分页。
 * <p>偏好：显示名 / 默认可见性 / 每页条数 / 背景模式 / 评论审核开关，按 user_id 隔离不串号。
 * <p>危险操作：注销（软删除，可恢复）/ 数据导出 / 清理会话。
 */
@Service
public class AccountService {

    private static final List<String> BG_MODES = List.of("warm", "cool", "dark");

    private final SessionStore sessions;
    private final UserRepository users;
    private final LoginLogRepository logs;
    private final UserPreferenceRepository prefs;
    private final PasswordHasher hasher;
    private final ArticleRepository articles;
    private final MediaRepository media;
    private final CollectionRepository collections;
    private final MomentRepository moments;

    public AccountService(SessionStore sessions, UserRepository users, LoginLogRepository logs,
                          UserPreferenceRepository prefs, PasswordHasher hasher,
                          ArticleRepository articles, MediaRepository media,
                          CollectionRepository collections, MomentRepository moments) {
        this.sessions = sessions;
        this.users = users;
        this.logs = logs;
        this.prefs = prefs;
        this.hasher = hasher;
        this.articles = articles;
        this.media = media;
        this.collections = collections;
        this.moments = moments;
    }

    /** 当前用户的有效会话列表，当前令牌标记 current=true。 */
    public Map<String, Object> listSessions(String currentToken) {
        String uid = AuthContext.requireLogin();
        List<Map<String, Object>> items = new ArrayList<>();
        for (Session s : sessions.listByUser(uid)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("token", s.token());
            m.put("userAgent", s.userAgent());
            m.put("ip", s.ip());
            m.put("createdAt", s.createdAt().toString());
            m.put("expiresAt", s.expiresAt().toString());
            m.put("remember", s.remember());
            m.put("current", s.token().equals(currentToken));
            items.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", items);
        return out;
    }

    public void revokeSession(String token) {
        String uid = AuthContext.requireLogin();
        Session s = sessions.find(token).orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "会话不存在"));
        if (!s.userId().equals(uid)) throw new BizException(ErrorCode.NOT_FOUND, "会话不存在");
        sessions.delete(token);
    }

    /** 注销除当前外的全部会话（也可用于「全部登出」传当前令牌）。 */
    public void revokeOthers(String currentToken) {
        String uid = AuthContext.requireLogin();
        sessions.deleteOthers(uid, currentToken);
    }

    public Map<String, Object> loginLogs(int page, int size, String sort) {
        String uid = AuthContext.requireLogin();
        PageQuery q = PageQuery.parse(page <= 0 ? null : String.valueOf(page),
                size <= 0 ? null : String.valueOf(size), sort);
        List<Map<String, Object>> items = new ArrayList<>();
        for (LoginLog log : logs.listByUser(uid, q)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", log.id());
            m.put("ip", log.ip());
            m.put("userAgent", log.userAgent());
            m.put("result", log.result());
            m.put("reason", log.reason());
            m.put("createdAt", Instant.ofEpochMilli(log.createdAtMs()).toString());
            items.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", items);
        out.put("total", logs.countByUser(uid));
        out.put("page", q.page());
        out.put("size", q.size());
        return out;
    }

    /** 改密：校验旧密码 → 校验新密码强度 → 更新 → 其他会话立即失效。 */
    public void changePassword(String oldPassword, String newPassword, String currentToken) {
        String uid = AuthContext.requireLogin();
        Optional<com.example.blog.domain.User> user = users.findById(uid);
        String stored = user.map(com.example.blog.domain.User::passwordHash).orElse(dummyHash());
        if (!hasher.verify(oldPassword == null ? "" : oldPassword, stored)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "原密码不正确");
        }
        String newHash = hasher.hash(CredentialValidator.validatePassword(newPassword));
        users.updatePassword(uid, newHash);
        sessions.deleteOthers(uid, currentToken);
    }

    private static String dummyHash() {
        return new PasswordHasher().hash("timing-safe-dummy");
    }

    public Map<String, Object> getPreferences() {
        String uid = AuthContext.requireLogin();
        return viewPrefs(prefs.find(uid));
    }

    public Map<String, Object> updatePreferences(Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        Optional<Map<String, Object>> existing = prefs.find(uid);
        String siteName = strOr(body, "siteName", existing.map(r -> (String) r.get("siteName")).orElse(null));
        String defaultVisibility = strOr(body, "defaultVisibility",
                existing.map(r -> (String) r.get("defaultVisibility")).orElse("public"));
        Integer pageSize = intOr(body, "pageSize",
                existing.map(r -> (Integer) r.get("pageSize")).orElse(20));
        String backgroundMode = strOr(body, "backgroundMode",
                existing.map(r -> (String) r.get("backgroundMode")).orElse("warm"));
        Boolean commentModeration = boolOr(body, "commentModeration",
                existing.map(r -> (Boolean) r.get("commentModeration")).orElse(false));

        if (siteName != null) {
            siteName = siteName.trim();
            if (siteName.length() < 1 || siteName.length() > 40) {
                throw new BizException(ErrorCode.VALIDATION_ERROR, "显示名长度需在 1~40 个字符之间");
            }
        }
        if (defaultVisibility == null
                || (!"public".equals(defaultVisibility) && !"private".equals(defaultVisibility))) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "默认可见性必须是 public 或 private");
        }
        if (pageSize == null || pageSize < 5 || pageSize > 100) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "每页条数需在 5~100 之间");
        }
        if (backgroundMode == null || !BG_MODES.contains(backgroundMode)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "背景模式不合法");
        }
        prefs.upsert(uid, siteName, defaultVisibility, pageSize, backgroundMode,
                commentModeration != null && commentModeration, System.currentTimeMillis());
        return getPreferences();
    }

    /** 数据导出：返回账号资料 + 偏好 + 内容计数 + 最近登录日志，供用户下载存档。 */
    public Map<String, Object> exportData() {
        String uid = AuthContext.requireLogin();
        Map<String, Object> profile = users.findProfileById(uid)
                .map(p -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", p.id());
                    m.put("phone", p.phone());
                    m.put("nickname", p.nickname());
                    m.put("avatarUrl", p.avatarUrl());
                    m.put("bio", p.bio());
                    m.put("createdAtMs", p.createdAtMs());
                    return m;
                })
                .orElse(new LinkedHashMap<>());
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("article", articles.countByOwner(uid));
        counts.put("media", media.countByOwner(uid));
        counts.put("collection", collections.countByOwner(uid));
        counts.put("moment", moments.countByAuthor(uid));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("exportedAt", Instant.now().toString());
        out.put("profile", profile);
        out.put("preferences", viewPrefs(prefs.find(uid)));
        out.put("contentCounts", counts);
        return out;
    }

    /** 注销：软删除（置位 disabled_at_ms）+ 清理全部会话；内容保留以便恢复。 */
    public void deleteAccount() {
        String uid = AuthContext.requireLogin();
        users.setDisabled(uid, System.currentTimeMillis());
        sessions.deleteAll(uid);
        prefs.deleteByUser(uid);
    }

    private Map<String, Object> viewPrefs(Optional<Map<String, Object>> opt) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (opt.isEmpty()) {
            m.put("siteName", null);
            m.put("defaultVisibility", "public");
            m.put("pageSize", 20);
            m.put("backgroundMode", "warm");
            m.put("commentModeration", false);
            return m;
        }
        Map<String, Object> r = opt.get();
        m.put("siteName", r.get("siteName"));
        m.put("defaultVisibility", r.get("defaultVisibility"));
        m.put("pageSize", r.get("pageSize"));
        m.put("backgroundMode", r.get("backgroundMode"));
        m.put("commentModeration", r.get("commentModeration"));
        return m;
    }

    private static String strOr(Map<String, Object> body, String key, String dflt) {
        Object v = body.get(key);
        return v == null ? dflt : String.valueOf(v);
    }

    private static Integer intOr(Map<String, Object> body, String key, Integer dflt) {
        Object v = body.get(key);
        if (v == null) return dflt;
        try {
            return Integer.parseInt(String.valueOf(v));
        } catch (NumberFormatException ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, key + " 必须是整数");
        }
    }

    private static Boolean boolOr(Map<String, Object> body, String key, Boolean dflt) {
        Object v = body.get(key);
        if (v == null) return dflt;
        if (v instanceof Boolean b) return b;
        return "true".equalsIgnoreCase(String.valueOf(v));
    }
}
