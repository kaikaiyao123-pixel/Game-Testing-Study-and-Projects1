package com.example.blog.domain;

/** 文章标签（F2）。站点级共享，slug 全局唯一。 */
public record Tag(
        String id,
        String name,
        String slug,
        long createdAtMs,
        Long deletedAtMs) {
}
