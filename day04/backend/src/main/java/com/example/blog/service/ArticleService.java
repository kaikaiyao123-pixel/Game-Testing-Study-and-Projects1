package com.example.blog.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.example.blog.domain.Article;
import com.example.blog.domain.Tag;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.PageResult;
import com.example.blog.foundation.markdown.MarkdownUtil;
import com.example.blog.repository.ArticleRepository;
import com.example.blog.repository.TagRepository;
import com.example.blog.repository.UserRepository;

/** F2 文章领域逻辑：CRUD、Markdown 渲染净化、slug 唯一化、标签关联、三级权限。 */
@Service
public class ArticleService {

    private final ArticleRepository articles;
    private final TagRepository tags;
    private final UserRepository users;

    public ArticleService(ArticleRepository articles, TagRepository tags, UserRepository users) {
        this.articles = articles;
        this.tags = tags;
        this.users = users;
    }

    public Map<String, Object> create(Map<String, Object> input, String authorId) {
        String title = str(input, "title");
        if (title == null || title.isBlank() || title.length() > 200) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "标题为必填，且不超过 200 字");
        }
        String contentMd = str(input, "content_md");
        if (contentMd == null) contentMd = "";
        if (contentMd.length() > 200_000) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "正文过长");
        }
        String status = str(input, "status", "draft");
        if (!List.of("draft", "published", "archived").contains(status)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "非法的状态值");
        }
        String visibility = str(input, "visibility", "public");
        if (!List.of("public", "private").contains(visibility)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "非法的可见性值");
        }
        String categoryId = str(input, "category_id");
        String coverUrl = str(input, "cover_url");
        String summary = str(input, "summary");
        if (summary == null || summary.isBlank()) {
            summary = plainPrefix(contentMd, 120);
        }
        long now = System.currentTimeMillis();
        String slug = uniqueSlug(slugify(title));
        String html = MarkdownUtil.toHtml(contentMd);
        Long publishedAt = "published".equals(status) ? now : null;

        Article a = new Article(articles.nextId(), authorId, title, slug, summary, contentMd, html,
                coverUrl, status, visibility, categoryId, 0L, publishedAt, now, now, null);
        articles.insert(a);
        applyTags(a.id(), input.get("tags"));
        return toDetailMap(a, true);
    }

    public Map<String, Object> update(String id, String authorId, Map<String, Object> input) {
        Article existing = articles.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "文章不存在"));
        if (!existing.authorId().equals(authorId)) {
            throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        }
        String title = str(input, "title", existing.title());
        String contentMd = str(input, "content_md", existing.contentMd());
        String status = str(input, "status", existing.status());
        String visibility = str(input, "visibility", existing.visibility());
        String categoryId = input.containsKey("category_id") ? str(input, "category_id") : existing.categoryId();
        String coverUrl = input.containsKey("cover_url") ? str(input, "cover_url") : existing.coverUrl();
        String summary = str(input, "summary");
        if (summary == null || summary.isBlank()) {
            summary = existing.summary();
            if (summary == null || summary.isBlank()) summary = plainPrefix(contentMd, 120);
        }
        long now = System.currentTimeMillis();
        String html = MarkdownUtil.toHtml(contentMd);
        Long publishedAt = existing.publishedAtMs();
        if ("published".equals(status) && publishedAt == null) publishedAt = now;

        Article updated = new Article(existing.id(), authorId, title, existing.slug(), summary,
                contentMd, html, coverUrl, status, visibility, categoryId, existing.viewCount(),
                publishedAt, existing.createdAtMs(), now, null);
        int n = articles.update(updated);
        if (n == 0) throw new BizException(ErrorCode.NOT_FOUND, "文章不存在");
        applyTags(updated.id(), input.get("tags"));
        return toDetailMap(updated, true);
    }

    public void delete(String id, String authorId) {
        int n = articles.softDelete(id, authorId, System.currentTimeMillis());
        if (n == 0) throw new BizException(ErrorCode.NOT_FOUND, "文章不存在");
    }

    public Map<String, Object> getById(String id, String viewerId) {
        Article a = articles.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "文章不存在"));
        ensureVisible(a, viewerId);
        if (viewerId == null || !viewerId.equals(a.authorId())) {
            articles.incrementView(id, 1);
        }
        return toDetailMap(a, true);
    }

    public Map<String, Object> getBySlug(String slug, String viewerId) {
        Article a = articles.findBySlug(slug)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "文章不存在"));
        ensureVisible(a, viewerId);
        return toDetailMap(a, true);
    }

    public Map<String, Object> listPublic(PageQuery q, String categoryId, String tagId, String query, String viewerId) {
        List<Article> rows = articles.listPublic(q, categoryId, tagId, query);
        long total = articles.countPublic(q, categoryId, tagId, query);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Article a : rows) items.add(toSummaryMap(a));
        return PageResult.of(items, total, q);
    }

    public Map<String, Object> listByAuthor(String authorId, PageQuery q) {
        List<Article> rows = articles.listByAuthor(authorId, q);
        long total = articles.countByAuthor(authorId);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Article a : rows) items.add(toSummaryMap(a));
        return PageResult.of(items, total, q);
    }

    public List<Map<String, Object>> recent(int limit) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (Article a : articles.recentPublic(limit)) items.add(toSummaryMap(a));
        return items;
    }

    public Map<String, Object> listPublicByAuthor(String authorId, PageQuery q) {
        List<Article> rows = articles.listPublicByAuthor(authorId, q);
        long total = articles.countPublicByAuthor(authorId);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Article a : rows) items.add(toSummaryMap(a));
        return PageResult.of(items, total, q);
    }

    public long countPublic() {
        return articles.countPublic();
    }

    public long countPublicByAuthor(String authorId) {
        return articles.countPublicByAuthor(authorId);
    }

    /* ---------- 内部工具 ---------- */

    private void ensureVisible(Article a, String viewerId) {
        if (a.deletedAtMs() != null) throw new BizException(ErrorCode.NOT_FOUND, "文章不存在");
        if ("private".equals(a.visibility()) && (viewerId == null || !viewerId.equals(a.authorId()))) {
            throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        }
        if (!"published".equals(a.status()) && (viewerId == null || !viewerId.equals(a.authorId()))) {
            throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        }
    }

    private void applyTags(String articleId, Object rawTags) {
        tags.unlinkArticle(articleId);
        if (!(rawTags instanceof List<?> list)) return;
        for (Object o : list) {
            String name = (o == null) ? null : String.valueOf(o).trim();
            if (name == null || name.isBlank() || name.length() > 40) continue;
            String base = slugify(name);
            // lambda 内引用必须是 effectively final，故用新变量承接空值兜底
            final String slug = base.isEmpty() ? "tag-" + UUID.randomUUID().toString().substring(0, 8) : base;
            final String tagName = name;
            Tag tag = tags.findBySlug(slug).orElseGet(() -> {
                Tag created = new Tag(tags.nextId(), tagName, slug, System.currentTimeMillis(), null);
                tags.insert(created);
                return created;
            });
            tags.linkArticle(articleId, tag.id());
        }
    }

    public Map<String, Object> toSummaryMap(Article a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.id());
        m.put("title", a.title());
        m.put("slug", a.slug());
        m.put("summary", a.summary());
        m.put("coverUrl", a.coverUrl());
        m.put("status", a.status());
        m.put("visibility", a.visibility());
        m.put("categoryId", a.categoryId());
        m.put("viewCount", a.viewCount());
        m.put("publishedAtMs", a.publishedAtMs());
        m.put("createdAtMs", a.createdAtMs());
        m.put("authorId", a.authorId());
        m.put("authorName", authorName(a.authorId()));
        return m;
    }

    public Map<String, Object> toDetailMap(Article a, boolean withContent) {
        Map<String, Object> m = toSummaryMap(a);
        m.put("tagNames", tags.listNamesByArticle(a.id()));
        if (withContent) {
            m.put("contentMd", a.contentMd());
            m.put("contentHtml", a.contentHtml());
            m.put("updatedAtMs", a.updatedAtMs());
        }
        return m;
    }

    private String authorName(String authorId) {
        try {
            return users.findById(authorId).map(u -> u.nickname()).orElse("匿名");
        } catch (Exception ex) {
            return "匿名";
        }
    }

    private String uniqueSlug(String base) {
        if (base == null || base.isEmpty()) base = "post";
        String candidate = base;
        int suffix = 2;
        while (articles.findBySlug(candidate).isPresent()) {
            candidate = base + "-" + suffix;
            suffix++;
        }
        return candidate;
    }

    private static String slugify(String text) {
        if (text == null) return "";
        String s = text.toLowerCase(Locale.ROOT).trim().replaceAll("\\s+", "-");
        s = s.replaceAll("[^a-z0-9\\u4e00-\\u9fa5\\-]", "");
        s = s.replaceAll("-+", "-").replaceAll("^-|-$", "");
        return s.length() > 80 ? s.substring(0, 80) : s;
    }

    private static String plainPrefix(String md, int max) {
        if (md == null) return "";
        String plain = md.replaceAll("#+", "").replaceAll("[*_`>]", "")
                .replaceAll("\\[([^\\]]+)\\]\\([^)]*\\)", "$1").trim();
        return plain.length() > max ? plain.substring(0, max) : plain;
    }

    @SuppressWarnings("unchecked")
    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static String str(Map<String, Object> m, String key, String dflt) {
        String v = str(m, key);
        return v == null ? dflt : v;
    }
}
