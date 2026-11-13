package com.example.blog.domain;

/** 评论实体（F8）。多态关联 target_type + target_id；status 为 pending/approved/rejected。 */
public record Comment(
        String id,
        String targetType,
        String targetId,
        String authorId,
        String content,
        String status,
        String parentId,
        long createdAtMs,
        Long deletedAtMs) {
}
