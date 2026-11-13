package com.example.blog.domain;

/** 文章分类（F2）。归属作者，slug 在作者范围内唯一。 */
public record Category(
        String id,
        String ownerId,
        String name,
        String slug,
        int sortOrder,
        long createdAtMs,
        Long deletedAtMs) {
}
