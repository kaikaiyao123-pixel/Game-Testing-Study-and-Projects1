package com.example.blog.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.Comment;
import com.example.blog.foundation.common.PageQuery;

/** 评论仓储（F8）。多态关联 target_type + target_id；支持按状态过滤（公开仅返回 approved）。 */
@Repository
public class CommentRepository {

    private final JdbcTemplate jdbc;

    private final RowMapper<Comment> mapper = (rs, rowNum) -> new Comment(
            rs.getString("id"),
            rs.getString("target_type"),
            rs.getString("target_id"),
            rs.getString("author_id"),
            rs.getString("content"),
            rs.getString("status"),
            rs.getString("parent_id"),
            rs.getLong("created_at_ms"),
            nullableLong(rs, "deleted_at_ms"));

    public CommentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    public void insert(Comment c) {
        jdbc.update(
                "INSERT INTO comment (id, target_type, target_id, author_id, content, status, parent_id, created_at_ms) "
                        + "VALUES (?,?,?,?,?,?,?,?)",
                c.id(), c.targetType(), c.targetId(), c.authorId(), c.content(), c.status(),
                c.parentId(), c.createdAtMs());
    }

    public List<Comment> listByTargetStatus(String targetType, String targetId, String status, PageQuery q) {
        String sql = "SELECT * FROM comment WHERE target_type=? AND target_id=? AND status=? AND deleted_at_ms IS NULL "
                + "ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?";
        return jdbc.query(sql, mapper, targetType, targetId, status, q.size(), q.offset());
    }

    public long countByTargetStatus(String targetType, String targetId, String status) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM comment WHERE target_type=? AND target_id=? AND status=? AND deleted_at_ms IS NULL",
                Long.class, targetType, targetId, status);
        return n == null ? 0L : n;
    }

    public List<Comment> listByTargetAll(String targetType, String targetId, PageQuery q) {
        String sql = "SELECT * FROM comment WHERE target_type=? AND target_id=? AND deleted_at_ms IS NULL "
                + "ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?";
        return jdbc.query(sql, mapper, targetType, targetId, q.size(), q.offset());
    }

    /**
     * 已登录的非内容作者视角：公开通过的评论 + 自己发表的评论（含待审核）。
     * 两者用 OR 组合，避免「自己刚发的评论看不见」。
     */
    public List<Comment> listVisibleToViewer(String targetType, String targetId, String viewerId, PageQuery q) {
        String sql = "SELECT * FROM comment WHERE target_type=? AND target_id=? AND deleted_at_ms IS NULL "
                + "AND (status='approved' OR author_id=?) "
                + "ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?";
        return jdbc.query(sql, mapper, targetType, targetId, viewerId, q.size(), q.offset());
    }

    public long countByTargetAuthor(String targetType, String targetId, String authorId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM comment WHERE target_type=? AND target_id=? AND author_id=? "
                        + "AND status<>'approved' AND deleted_at_ms IS NULL",
                Long.class, targetType, targetId, authorId);
        return n == null ? 0L : n;
    }

    public Optional<Comment> findById(String id) {
        List<Comment> rows = jdbc.query(
                "SELECT * FROM comment WHERE id=? AND deleted_at_ms IS NULL", mapper, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int softDelete(String id, long deletedAtMs) {
        return jdbc.update("UPDATE comment SET deleted_at_ms=? WHERE id=? AND deleted_at_ms IS NULL",
                deletedAtMs, id);
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }
}
