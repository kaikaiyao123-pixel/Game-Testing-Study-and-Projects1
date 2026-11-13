package com.example.blog.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.Article;
import com.example.blog.foundation.common.PageQuery;

/** 文章仓储（F2）。显式 SQL，全部参数化；软删除用 deleted_at_ms。 */
@Repository
public class ArticleRepository {

    private final JdbcTemplate jdbc;

    private final RowMapper<Article> mapper = (rs, rowNum) -> new Article(
            rs.getString("id"),
            rs.getString("author_id"),
            rs.getString("title"),
            rs.getString("slug"),
            rs.getString("summary"),
            rs.getString("content_md"),
            rs.getString("content_html"),
            rs.getString("cover_url"),
            rs.getString("status"),
            rs.getString("visibility"),
            rs.getString("category_id"),
            rs.getLong("view_count"),
            nullableLong(rs, "published_at_ms"),
            rs.getLong("created_at_ms"),
            nullableLong(rs, "updated_at_ms"),
            nullableLong(rs, "deleted_at_ms"));

    public ArticleRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    public void insert(Article a) {
        jdbc.update(
                "INSERT INTO article (id, author_id, title, slug, summary, content_md, content_html, "
                        + "cover_url, status, visibility, category_id, view_count, published_at_ms, created_at_ms, updated_at_ms) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                a.id(), a.authorId(), a.title(), a.slug(), a.summary(), a.contentMd(), a.contentHtml(),
                a.coverUrl(), a.status(), a.visibility(), a.categoryId(), a.viewCount(),
                a.publishedAtMs(), a.createdAtMs(), a.updatedAtMs());
    }

    public int update(Article a) {
        return jdbc.update(
                "UPDATE article SET title=?, slug=?, summary=?, content_md=?, content_html=?, "
                        + "cover_url=?, status=?, visibility=?, category_id=?, published_at_ms=?, updated_at_ms=? "
                        + "WHERE id=? AND author_id=? AND deleted_at_ms IS NULL",
                a.title(), a.slug(), a.summary(), a.contentMd(), a.contentHtml(),
                a.coverUrl(), a.status(), a.visibility(), a.categoryId(), a.publishedAtMs(),
                a.updatedAtMs(), a.id(), a.authorId());
    }

    public int softDelete(String id, String authorId, long deletedAtMs) {
        return jdbc.update(
                "UPDATE article SET deleted_at_ms=? WHERE id=? AND author_id=? AND deleted_at_ms IS NULL",
                deletedAtMs, id, authorId);
    }

    public int incrementView(String id, long delta) {
        return jdbc.update(
                "UPDATE article SET view_count = view_count + ? WHERE id=? AND deleted_at_ms IS NULL",
                delta, id);
    }

    public Optional<Article> findById(String id) {
        List<Article> rows = jdbc.query(
                "SELECT * FROM article WHERE id=? AND deleted_at_ms IS NULL", mapper, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<Article> findBySlug(String slug) {
        List<Article> rows = jdbc.query(
                "SELECT * FROM article WHERE slug=? AND deleted_at_ms IS NULL", mapper, slug);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public boolean existsByIdAndAuthor(String id, String authorId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM article WHERE id=? AND author_id=? AND deleted_at_ms IS NULL",
                Long.class, id, authorId);
        return n != null && n > 0;
    }

    public long countPublic() {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM article WHERE deleted_at_ms IS NULL AND status='published' AND visibility='public'",
                Long.class);
        return n == null ? 0L : n;
    }

    public List<Article> listPublic(PageQuery q, String categoryId, String tagId, String qText) {
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM article WHERE deleted_at_ms IS NULL AND status='published' AND visibility='public'");
        List<Object> args = new ArrayList<>();
        if (categoryId != null && !categoryId.isBlank()) {
            sql.append(" AND category_id=?");
            args.add(categoryId);
        }
        if (tagId != null && !tagId.isBlank()) {
            sql.append(" AND id IN (SELECT article_id FROM article_tag WHERE tag_id=?)");
            args.add(tagId);
        }
        if (qText != null && !qText.isBlank()) {
            sql.append(" AND (title LIKE ? OR summary LIKE ?)");
            String like = qText.trim() + "%";
            args.add(like);
            args.add(like);
        }
        sql.append(" ORDER BY ").append(q.orderBy()).append(" LIMIT ? OFFSET ?");
        args.add(q.size());
        args.add(q.offset());
        return jdbc.query(sql.toString(), mapper, args.toArray());
    }

    public long countPublic(PageQuery q, String categoryId, String tagId, String qText) {
        StringBuilder sql = new StringBuilder(
                "SELECT COUNT(*) FROM article WHERE deleted_at_ms IS NULL AND status='published' AND visibility='public'");
        List<Object> args = new ArrayList<>();
        if (categoryId != null && !categoryId.isBlank()) {
            sql.append(" AND category_id=?");
            args.add(categoryId);
        }
        if (tagId != null && !tagId.isBlank()) {
            sql.append(" AND id IN (SELECT article_id FROM article_tag WHERE tag_id=?)");
            args.add(tagId);
        }
        if (qText != null && !qText.isBlank()) {
            sql.append(" AND (title LIKE ? OR summary LIKE ?)");
            String like = qText.trim() + "%";
            args.add(like);
            args.add(like);
        }
        Long n = jdbc.queryForObject(sql.toString(), Long.class, args.toArray());
        return n == null ? 0L : n;
    }

    public List<Article> listByAuthor(String authorId, PageQuery q) {
        String sql = "SELECT * FROM article WHERE author_id=? AND deleted_at_ms IS NULL "
                + "ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?";
        return jdbc.query(sql, mapper, authorId, q.size(), q.offset());
    }

    public long countByAuthor(String authorId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM article WHERE author_id=? AND deleted_at_ms IS NULL",
                Long.class, authorId);
        return n == null ? 0L : n;
    }

    /** 导出用别名（作者即 owner）。 */
    public long countByOwner(String ownerId) {
        return countByAuthor(ownerId);
    }

    public List<Article> recentPublic(int limit) {
        return jdbc.query(
                "SELECT * FROM article WHERE deleted_at_ms IS NULL AND status='published' AND visibility='public' "
                        + "ORDER BY published_at_ms DESC LIMIT ?",
                mapper, limit);
    }

    public List<Article> listPublicByAuthor(String authorId, PageQuery q) {
        String sql = "SELECT * FROM article WHERE author_id=? AND deleted_at_ms IS NULL "
                + "AND status='published' AND visibility='public' ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?";
        return jdbc.query(sql, mapper, authorId, q.size(), q.offset());
    }

    public long countPublicByAuthor(String authorId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM article WHERE author_id=? AND deleted_at_ms IS NULL "
                        + "AND status='published' AND visibility='public'",
                Long.class, authorId);
        return n == null ? 0L : n;
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }
}
