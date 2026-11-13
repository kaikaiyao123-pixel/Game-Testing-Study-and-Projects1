package com.example.blog.domain;

/** 点赞 / 收藏实体（F8）。target_type + target_id + user_id + type 联合唯一。 */
public record Reaction(
        String id,
        String targetType,
        String targetId,
        String userId,
        String type,
        long createdAtMs) {
}
