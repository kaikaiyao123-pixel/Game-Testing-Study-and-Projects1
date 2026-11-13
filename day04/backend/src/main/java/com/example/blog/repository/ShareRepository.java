package com.example.blog.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.Share;

/** 分享链接仓储（F8）。匿名持 token 可读；撤销或过期后不可见。 */
@Repository
public class ShareRepository {

    private final JdbcTemplate jdbc;

    private final RowMapper<Share> mapper = (rs, rowNum) -> new Share(
            rs.getString("id"),
            rs.getString("target_type"),
            rs.getString("target_id"),
            rs.getString("token"),
            rs.getString("created_by"),
            nullableLong(rs, "expires_at_ms"),
            rs.getLong("view_count"),
            rs.getLong("created_at_ms"),
            nullableLong(rs, "revoked_at_ms"));

    public ShareRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    public void insert(Share s) {
        jdbc.update(
                "INSERT INTO share (id, target_type, target_id, token, created_by, expires_at_ms, view_count, created_at_ms) "
                        + "VALUES (?,?,?,?,?,?,?,?)",
                s.id(), s.targetType(), s.targetId(), s.token(), s.createdBy(),
                s.expiresAtMs(), s.viewCount(), s.createdAtMs());
    }

    /** 匿名可读：仅返回未撤销且未过期的分享。 */
    public Optional<Share> findByTokenValid(String token) {
        long now = System.currentTimeMillis();
        List<Share> rows = jdbc.query(
                "SELECT * FROM share WHERE token=? AND revoked_at_ms IS NULL "
                        + "AND (expires_at_ms IS NULL OR expires_at_ms > ?) LIMIT 1",
                mapper, token, now);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int revoke(String id, String createdBy, long revokedAtMs) {
        return jdbc.update(
                "UPDATE share SET revoked_at_ms=? WHERE id=? AND created_by=? AND revoked_at_ms IS NULL",
                revokedAtMs, id, createdBy);
    }

    /** 撤销前校验归属用：返回任意状态（含已撤销）的分享，按 id 精确查找。 */
    public Optional<Share> findById(String id) {
        List<Share> rows = jdbc.query(
                "SELECT * FROM share WHERE id=? LIMIT 1", mapper, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int incrementView(String id) {
        return jdbc.update("UPDATE share SET view_count = view_count + 1 WHERE id=?", id);
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }

    public String nextToken() {
        return UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
