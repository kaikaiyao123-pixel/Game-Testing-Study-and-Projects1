package com.example.blog.foundation.security;

import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;

/**
 * P3 三级权限的单一实现：公开读 / 登录读 owner / 作者写，越权与不存在统一 404。
 *
 * 与 AuthContext.requireOwner() 的区别：本类用于「读取已取到的行」，
 * 入参为行内 visibility 与 owner_id，不依赖 ThreadLocal，便于 Service 层复用。
 */
public final class ReadGuard {

    private ReadGuard() {
    }

    public static boolean canRead(String visibility, String ownerId, String viewerId) {
        if ("public".equals(visibility)) return true;
        return viewerId != null && viewerId.equals(ownerId);
    }

    public static void require(String visibility, String ownerId, String viewerId) {
        if (!canRead(visibility, ownerId, viewerId)) {
            throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        }
    }

    /** 互动（评论 / 点赞 / 分享）额外要求：目标必须存在且对当前 viewer 可见。 */
    public static void requireInteractable(String visibility, String ownerId, String viewerId) {
        require(visibility, ownerId, viewerId);
    }
}
