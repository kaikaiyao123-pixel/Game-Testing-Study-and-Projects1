package com.example.blog.service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.stereotype.Service;

import com.example.blog.domain.Comment;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.PageResult;
import com.example.blog.foundation.repository.SiteConfigStore;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.foundation.security.RateLimiter;
import com.example.blog.repository.CommentRepository;
import com.example.blog.repository.UserRepository;

/** F8 评论领域逻辑：仅登录可发表（P9）、审核队列、限流、作者/内容作者可删除。 */
@Service
public class CommentService {

    private final CommentRepository comments;
    private final ContentTargetService targets;
    private final RateLimiter rateLimiter;
    private final SiteConfigStore siteConfig;
    private final UserRepository users;

    public CommentService(CommentRepository comments, ContentTargetService targets,
                         RateLimiter rateLimiter, SiteConfigStore siteConfig, UserRepository users) {
        this.comments = comments;
        this.targets = targets;
        this.rateLimiter = rateLimiter;
        this.siteConfig = siteConfig;
        this.users = users;
    }

    public Map<String, Object> create(Map<String, Object> input, String authorId, String ip) {
        String targetType = str(input, "target_type");
        String targetId = str(input, "target_id");
        String content = str(input, "content");
        if (targetType == null || targetId == null || content == null || content.isBlank()) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "评论目标与内容均为必填");
        }
        if (content.length() > 2000) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "评论内容不超过 2000 字");
        }
        // 目标必须存在、未删除且对评论者可见（私有目标仅作者可评论）
        targets.requireInteractable(targetType, targetId, authorId);

        // F8 反灌水：用户 + 目标双重限流（评论最小间隔）
        rateLimiter.requireAllowed("comment:user:" + authorId,
                20, Duration.ofMinutes(1), "评论过于频繁，请稍后再试");
        rateLimiter.requireAllowed("comment:target:" + targetType + ":" + targetId,
                30, Duration.ofMinutes(1), "该内容评论过于频繁，请稍后再试");

        boolean moderation = !"false".equalsIgnoreCase(siteConfig.find("site.comment-moderation").orElse("true"));
        String status = moderation ? "pending" : "approved";

        Comment c = new Comment(comments.nextId(), targetType, targetId, authorId, content,
                status, str(input, "parent_id"), System.currentTimeMillis(), null);
        comments.insert(c);
        return toMap(c);
    }

    public Map<String, Object> list(String targetType, String targetId, String viewerId, PageQuery q) {
        // 目标必须存在且对 viewer 可见（私有目标匿名/非作者一律不可见，连评论都不暴露）
        targets.requireInteractable(targetType, targetId, viewerId);
        List<Comment> rows;
        long total;
        boolean isOwner = isTargetOwner(targetType, targetId, viewerId);
        if (isOwner) {
            // 内容作者：可审阅全部状态（approved / pending / rejected）
            rows = comments.listByTargetAll(targetType, targetId, q);
            total = comments.countByTargetStatus(targetType, targetId, "approved")
                    + comments.countByTargetStatus(targetType, targetId, "pending")
                    + comments.countByTargetStatus(targetType, targetId, "rejected");
        } else if (viewerId != null) {
            // 已登录但非内容作者：公开的 approved + 自己发表的（含待审核），
            // 否则用户提交后看不到自己刚发的评论，会误以为发表失败而重复提交。
            rows = comments.listVisibleToViewer(targetType, targetId, viewerId, q);
            total = comments.countByTargetStatus(targetType, targetId, "approved")
                    + comments.countByTargetAuthor(targetType, targetId, viewerId);
        } else {
            rows = comments.listByTargetStatus(targetType, targetId, "approved", q);
            total = comments.countByTargetStatus(targetType, targetId, "approved");
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (Comment c : rows) items.add(toMap(c));
        return PageResult.of(items, total, q);
    }

    public void delete(String commentId, String viewerId) {
        Comment c = comments.findById(commentId)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "评论不存在"));
        boolean isAuthor = viewerId != null && viewerId.equals(c.authorId());
        boolean isContentOwner = viewerId != null && isTargetOwner(c.targetType(), c.targetId(), viewerId);
        if (!isAuthor && !isContentOwner) {
            throw new BizException(ErrorCode.FORBIDDEN, "无权删除该评论");
        }
        comments.softDelete(commentId, System.currentTimeMillis());
    }

    private boolean isTargetOwner(String targetType, String targetId, String viewerId) {
        if (viewerId == null) return false;
        ContentTargetService.Resolved r = targets.resolve(targetType, targetId);
        return viewerId.equals(r.ownerId());
    }

    private Map<String, Object> toMap(Comment c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.id());
        m.put("targetType", c.targetType());
        m.put("targetId", c.targetId());
        m.put("content", c.content());
        m.put("status", c.status());
        m.put("parentId", c.parentId());
        m.put("authorId", c.authorId());
        m.put("authorName", authorName(c.authorId()));
        m.put("createdAtMs", c.createdAtMs());
        return m;
    }

    private String authorName(String authorId) {
        try {
            return users.findProfileById(authorId).map(u -> u.nickname()).orElse("匿名");
        } catch (Exception ex) {
            return "匿名";
        }
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
