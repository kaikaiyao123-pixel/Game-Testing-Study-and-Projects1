package com.example.blog.foundation.security;

import java.time.Instant;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import com.example.blog.domain.Session;
import com.example.blog.repository.SessionStore;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 统一令牌解析 + 上下文注入（文档 §5.1 / §5.2：单一解析组件）。
 *
 * 零回归的关键设计：本拦截器「从不拒绝请求」，preHandle 恒返回 true。
 * 无令牌 / 令牌无效 / 会话过期 / Redis 异常一律按访客注入上下文，由各新接口
 * 自行决定是否要求登录。现有 5 个鉴权 API 仍走 AuthController 自己的手工解析，
 * 且不读本上下文，因此响应字段与 HTTP 状态码完全不受影响。
 */
@Component
public class AuthContextInterceptor implements HandlerInterceptor {

    private static final int MAX_TOKEN_LENGTH = 512;

    private final SessionStore sessions;

    public AuthContextInterceptor(SessionStore sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        try {
            String token = bearer(request.getHeader("Authorization"));
            if (token == null) {
                AuthContext.set(AuthContext.Principal.anonymous());
                return true;
            }
            Session session = sessions.find(token).orElse(null);
            if (session == null
                    || session.userId() == null || session.userId().isBlank()
                    || session.expiresAt() == null
                    || !session.expiresAt().isAfter(Instant.now())) {
                AuthContext.set(AuthContext.Principal.anonymous());
                return true;
            }
            // F0 滑动续期：记住我会话每次活动都把 TTL 重新对齐到「创建 + 30 天」
            sessions.slideIfNeeded(session);
            AuthContext.set(AuthContext.Principal.loggedIn(token, session.userId()));
        } catch (Exception ex) {
            // 拦截器自身任何异常都必须降级为访客，绝不让既有接口出现 500
            AuthContext.set(AuthContext.Principal.anonymous());
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        AuthContext.clear();
    }

    private static String bearer(String header) {
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) return null;
        String token = header.substring(7).trim();
        if (token.isEmpty() || token.length() > MAX_TOKEN_LENGTH) return null;
        return token;
    }
}
