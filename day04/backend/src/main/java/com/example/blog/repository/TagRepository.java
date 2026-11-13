package com.example.blog.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.Tag;

/** 标签仓储（F2）。站点级共享，slug 全局唯一；文章-标签关联在此维护。 */
@Repository
public class TagRepository {

    private final JdbcTemplate jdbc;

    private final RowMapper<Tag> mapper = (rs, rowNum) -> new Tag(
            rs.getString("id"),
            rs.getString("name"),
            rs.getString("slug"),
            rs.getLong("created_at_ms"),
            nullableLong(rs, "deleted_at_ms"));

    public TagRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    public List<Tag> listAll() {
        return jdbc.query(
                "SELECT * FROM tag WHERE deleted_at_ms IS NULL ORDER BY name ASC", mapper);
    }

    public Optional<Tag> findBySlug(String slug) {
        List<Tag> rows = jdbc.query(
                "SELECT * FROM tag WHERE slug=? AND deleted_at_ms IS NULL", mapper, slug);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void insert(Tag t) {
        jdbc.update(
                "INSERT INTO tag (id, name, slug, created_at_ms) VALUES (?,?,?,?)",
                t.id(), t.name(), t.slug(), t.createdAtMs());
    }

    public void linkArticle(String articleId, String tagId) {
        jdbc.update(
                "INSERT IGNORE INTO article_tag (article_id, tag_id) VALUES (?,?)", articleId, tagId);
    }

    public void unlinkArticle(String articleId) {
        jdbc.update("DELETE FROM article_tag WHERE article_id=?", articleId);
    }

    /** 某文章挂载的标签名，按名称升序（详情页展示用）。 */
    public List<String> listNamesByArticle(String articleId) {
        return jdbc.queryForList(
                "SELECT t.name FROM tag t JOIN article_tag at ON at.tag_id = t.id "
                        + "WHERE at.article_id=? AND t.deleted_at_ms IS NULL ORDER BY t.name ASC",
                String.class, articleId);
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }
}
