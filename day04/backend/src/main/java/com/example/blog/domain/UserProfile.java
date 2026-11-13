package com.example.blog.domain;

/** 用户资料视图（F6）。含 V1 迁移扩展字段；手机号按需脱敏，不在此实体内直接暴露。 */
public record UserProfile(
        String id,
        String phone,
        String nickname,
        String avatarUrl,
        String bio,
        long createdAtMs,
        Long updatedAtMs,
        Long disabledAtMs) {
}
