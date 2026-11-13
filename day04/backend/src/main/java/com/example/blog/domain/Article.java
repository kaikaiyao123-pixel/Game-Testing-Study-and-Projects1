package com.example.blog.domain;

/** 文章实体（F2）。软删除通过 deleted_at_ms 表达；status 为 draft/published/archived。 */
public record Article(
        String id,
        String authorId,
        String title,
        String slug,
        String summary,
        String contentMd,
        String contentHtml,
        String coverUrl,
        String status,
        String visibility,
        String categoryId,
        long viewCount,
        Long publishedAtMs,
        long createdAtMs,
        Long updatedAtMs,
        Long deletedAtMs) {
}
