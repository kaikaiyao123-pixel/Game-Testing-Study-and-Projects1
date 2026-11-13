package com.example.blog.domain;

import java.time.Instant;

/** 会话实体，实际存储在 Redis，键为 blog:session:&lt;token&gt;。 */
public record Session(
        String token,
        String userId,
        Instant createdAt,
        Instant expiresAt,
        String userAgent,
        String ip,
        boolean remember) {
}
