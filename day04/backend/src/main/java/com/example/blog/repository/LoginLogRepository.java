package com.example.blog.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.LoginLog;
import com.example.blog.foundation.common.PageQuery;

/** 登录审计仓储（F0-5）。只写与按用户分页读。 */
@Repository
public class LoginLogRepository {

    private final JdbcTemplate jdbc;

    private final RowMapper<LoginLog> mapper = (rs, rowNum) -> new LoginLog(
            rs.getString("id"),
            rs.getString("user_id"),
            rs.getString("phone"),
            rs.getString("ip"),
            rs.getString("user_agent"),
            rs.getString("result"),
            rs.getString("reason"),
            rs.getLong("created_at_ms"));

    public LoginLogRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(LoginLog log) {
        jdbc.update(
                "INSERT INTO login_log (id, user_id, phone, ip, user_agent, result, reason, created_at_ms) "
                        + "VALUES (?,?,?,?,?,?,?,?)",
                log.id(), log.userId(), log.phone(), log.ip(), log.userAgent(),
                log.result(), log.reason(), log.createdAtMs());
    }

    public List<LoginLog> listByUser(String userId, PageQuery q) {
        String sql = "SELECT * FROM login_log WHERE user_id=? ORDER BY " + q.orderBy()
                + " LIMIT ? OFFSET ?";
        return jdbc.query(sql, mapper, userId, q.size(), q.offset());
    }

    public long countByUser(String userId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM login_log WHERE user_id=?", Long.class, userId);
        return n == null ? 0L : n;
    }

    public String nextId() {
        return java.util.UUID.randomUUID().toString();
    }
}
