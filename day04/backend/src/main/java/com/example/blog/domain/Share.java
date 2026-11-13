package com.example.blog.domain;

/** 分享链接实体（F8）。token 匿名可读；revoked_at_ms 非空即已撤销。 */
public record Share(
        String id,
        String targetType,
        String targetId,
        String token,
        String createdBy,
        Long expiresAtMs,
        long viewCount,
        long createdAtMs,
        Long revokedAtMs) {
}
