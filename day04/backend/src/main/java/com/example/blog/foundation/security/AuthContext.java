package com.example.blog.foundation.security;

import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;

/**
 * P0 统一鉴权上下文（请求作用域 ThreadLocal，由 AuthContextInterceptor 注入）。
 *
 * 访客态是「显式状态」而非 null：公开读接口据此返回 200（决策 2 / P9），
 * 写接口据此抛 401。后续 30+ 接口不再各自解析 Bearer（P2 复用而非重建）。
 */
public final class AuthContext {

    private static final ThreadLocal<Principal> CURRENT = new ThreadLocal<>();
    private static final Principal GUEST = new Principal(null, null, true);

    private AuthContext() {
    }

    public record Principal(String token, String userId, boolean guest) {

        /** 不能命名为 guest()：record 组件 guest 已生成同签名的 boolean 访问器。 */
        public static Principal anonymous() {
            return GUEST;
        }

        public static Principal loggedIn(String token, String userId) {
            return new Principal(token, userId, false);
        }
    }

    public static void set(Principal principal) {
        CURRENT.set(principal == null ? GUEST : principal);
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static Principal current() {
        Principal principal = CURRENT.get();
        return principal == null ? GUEST : principal;
    }

    public static boolean isGuest() {
        return current().guest();
    }

    public static String userIdOrNull() {
        return current().userId();
    }

    /** P9：发布 / 编辑 / 删除 / 评论 / 点赞 / 上传 / 资料 / 设置一律调用本方法。 */
    public static String requireLogin() {
        Principal principal = current();
        if (principal.guest() || principal.userId() == null || principal.userId().isBlank()) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "请先登录后再操作");
        }
        return principal.userId();
    }

    /**
     * 文档 §5.4：owner 不匹配统一返回 404，而不是 403，
     * 避免通过状态码差异泄露「资源是否存在」。
     */
    public static String requireOwner(String ownerId) {
        String userId = requireLogin();
        if (ownerId == null || !ownerId.equals(userId)) {
            throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        }
        return userId;
    }
}
