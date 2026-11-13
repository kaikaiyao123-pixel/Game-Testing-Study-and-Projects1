package com.example.blog.service;

import java.util.Map;

import org.springframework.stereotype.Service;

import com.example.blog.domain.Article;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.RowMap;
import com.example.blog.foundation.security.ReadGuard;
import com.example.blog.repository.ArticleRepository;
import com.example.blog.repository.CollectionRepository;
import com.example.blog.repository.MediaRepository;
import com.example.blog.repository.MomentRepository;

/**
 * F8 多态目标解析：给定 (target_type, target_id)，返回目标归属作者与可见性。
 * 应用层负责「目标存在 / 未删除 / 当前可见性允许互动」的校验（§5.10 多态约束）。
 *
 * P2 仅 article；P3/W0 接入 media / collection / moment：三个仓储的 findById
 * 都带 deleted_at_ms IS NULL，因此目标软删除后 comment / reaction / share
 * 三条链路同时不可见（不物理删除历史数据，注销/删除后仍可恢复）。
 */
@Service
public class ContentTargetService {

    private static final String GONE = "资源不存在";

    private final ArticleRepository articles;
    private final MediaRepository media;
    private final CollectionRepository collections;
    private final MomentRepository moments;

    public ContentTargetService(ArticleRepository articles, MediaRepository media,
                                CollectionRepository collections, MomentRepository moments) {
        this.articles = articles;
        this.media = media;
        this.collections = collections;
        this.moments = moments;
    }

    public record Resolved(String ownerId, String visibility) {
    }

    public Resolved resolve(String targetType, String targetId) {
        if (targetType == null || targetId == null || targetId.isBlank()) {
            throw new BizException(ErrorCode.NOT_FOUND, GONE);
        }
        return switch (targetType) {
            case "article" -> {
                Article a = articles.findById(targetId)
                        .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, GONE));
                yield new Resolved(a.authorId(), a.visibility());
            }
            case "media" -> fromRow(media.findById(targetId), "ownerId");
            case "collection" -> fromRow(collections.findById(targetId), "ownerId");
            case "moment" -> fromRow(moments.findById(targetId), "authorId");
            default -> throw new BizException(ErrorCode.NOT_FOUND, GONE);
        };
    }

    /** W7：互动前校验「目标存在 + 当前可见性允许」，私有目标对非作者一律 404。 */
    public Resolved requireInteractable(String targetType, String targetId, String viewerId) {
        Resolved r = resolve(targetType, targetId);
        ReadGuard.requireInteractable(r.visibility(), r.ownerId(), viewerId);
        return r;
    }

    private static Resolved fromRow(java.util.Optional<Map<String, Object>> row, String ownerKey) {
        Map<String, Object> m = row.orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, GONE));
        return new Resolved(RowMap.str(m, ownerKey), RowMap.str(m, "visibility"));
    }
}
