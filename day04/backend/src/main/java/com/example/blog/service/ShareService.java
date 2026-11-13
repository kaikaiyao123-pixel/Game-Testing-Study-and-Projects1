package com.example.blog.service;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.example.blog.domain.Share;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.repository.ShareRepository;

/** F8 分享：登录用户为公开内容生成匿名可读链接；支持过期与撤销。 */
@Service
public class ShareService {

    private final ShareRepository shares;
    private final ContentTargetService targets;
    private final ArticleService articles;
    private final MediaService media;
    private final CollectionService collections;
    private final MomentService moments;

    public ShareService(ShareRepository shares, ContentTargetService targets, ArticleService articles,
                        MediaService media, CollectionService collections, MomentService moments) {
        this.shares = shares;
        this.targets = targets;
        this.articles = articles;
        this.media = media;
        this.collections = collections;
        this.moments = moments;
    }

    public Map<String, Object> create(String targetType, String targetId, String userId, Long expiresInSeconds) {
        ContentTargetService.Resolved r = targets.resolve(targetType, targetId);
        if (!"public".equals(r.visibility())) {
            throw new BizException(ErrorCode.FORBIDDEN, "仅公开内容可生成分享链接");
        }
        String token = shares.nextToken();
        Long expires = (expiresInSeconds != null && expiresInSeconds > 0)
                ? System.currentTimeMillis() + expiresInSeconds * 1000L : null;
        Share s = new Share(shares.nextId(), targetType, targetId, token, userId, expires,
                0L, System.currentTimeMillis(), null);
        shares.insert(s);
        Map<String, Object> m = new LinkedHashMap<>();
        // 返回 id 供创建者后续撤销（DELETE /api/shares/{id}）；不暴露 token 之外的信息
        m.put("id", s.id());
        m.put("token", token);
        m.put("url", "/share.html?token=" + token);
        return m;
    }

    public void revoke(String shareId, String userId) {
        Share s = shares.findById(shareId)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "分享不存在"));
        if (!s.createdBy().equals(userId)) {
            throw new BizException(ErrorCode.FORBIDDEN, "无权操作该分享链接");
        }
        int n = shares.revoke(shareId, userId, System.currentTimeMillis());
        if (n == 0) throw new BizException(ErrorCode.NOT_FOUND, "分享不存在");
    }

    /** 匿名只读：持有效 token 即可读取目标内容，无需登录；公开集合的可选访问口令在此校验。 */
    public Map<String, Object> getByToken(String token, String password) {
        Share s = shares.findByTokenValid(token)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "分享链接不存在或已失效"));
        ContentTargetService.Resolved r = targets.resolve(s.targetType(), s.targetId());
        if (!"public".equals(r.visibility())) {
            throw new BizException(ErrorCode.NOT_FOUND, "内容不可见");
        }
        shares.incrementView(s.id());
        Map<String, Object> content = viewContent(s.targetType(), s.targetId(), password);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("targetType", s.targetType());
        m.put("targetId", s.targetId());
        m.put("viewCount", s.viewCount() + 1);
        m.put("content", content);
        return m;
    }

    /** 按 target 类型解析匿名可见内容（不含私有字段）。password 仅用于公开集合的可选访问口令。 */
    private Map<String, Object> viewContent(String targetType, String targetId, String password) {
        return switch (targetType) {
            case "article" -> articles.getById(targetId, null);
            case "media" -> media.get(targetId, null);
            case "collection" -> collections.getPublic(targetId, password);
            case "moment" -> moments.getById(targetId, null);
            default -> new LinkedHashMap<String, Object>();
        };
    }
}
