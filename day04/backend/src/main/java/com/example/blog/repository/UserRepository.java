package com.example.blog.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.User;
import com.example.blog.domain.UserProfile;

/** MySQL 用户仓储。显式 SQL，无 ORM 隐式行为，便于核对索引与写入语句。 */
@Repository
public class UserRepository {

    private final JdbcTemplate jdbc;

    private final RowMapper<User> mapper = (rs, rowNum) -> new User(
            rs.getString("id"),
            rs.getString("phone"),
            rs.getString("nickname"),
            rs.getString("password_hash"),
            rs.getLong("created_at_ms"),
            nullableLong(rs, "last_login_at_ms"),
            rs.getInt("login_fails"),
            rs.getLong("locked_until_ms"));

    public UserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    public Optional<User> findByPhone(String phone) {
        List<User> rows = jdbc.query("SELECT * FROM `user` WHERE phone = ?", mapper, phone);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public Optional<User> findById(String id) {
        List<User> rows = jdbc.query("SELECT * FROM `user` WHERE id = ?", mapper, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public void insert(User user) {
        jdbc.update(
                "INSERT INTO `user` (id, phone, nickname, password_hash, created_at_ms, last_login_at_ms, login_fails, locked_until_ms) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                user.id(), user.phone(), user.nickname(), user.passwordHash(),
                user.createdAtMs(), user.lastLoginAtMs(), user.loginFails(), user.lockedUntilMs());
    }

    public void recordLoginFailure(String id, int fails, long lockedUntilMs) {
        jdbc.update("UPDATE `user` SET login_fails = ?, locked_until_ms = ? WHERE id = ?",
                fails, lockedUntilMs, id);
    }

    public void markLoginSuccess(String id, long lastLoginAtMs) {
        jdbc.update("UPDATE `user` SET login_fails = 0, locked_until_ms = 0, last_login_at_ms = ? WHERE id = ?",
                lastLoginAtMs, id);
    }

    public long count() {
        Long value = jdbc.queryForObject("SELECT COUNT(*) FROM `user`", Long.class);
        return value == null ? 0L : value;
    }

    public int deleteByPhone(String phone) {
        return jdbc.update("DELETE FROM `user` WHERE phone = ?", phone);
    }

    /* ---------- F6 资料扩展（V1 迁移字段：avatar_url / bio / updated_at_ms） ---------- */

    private final org.springframework.jdbc.core.RowMapper<UserProfile> profileMapper = (rs, rn) -> new UserProfile(
            rs.getString("id"),
            rs.getString("phone"),
            rs.getString("nickname"),
            rs.getString("avatar_url"),
            rs.getString("bio"),
            rs.getLong("created_at_ms"),
            nullableLong(rs, "updated_at_ms"),
            nullableLong(rs, "disabled_at_ms"));

    public Optional<UserProfile> findProfileById(String id) {
        List<UserProfile> rows = jdbc.query(
                "SELECT id, phone, nickname, avatar_url, bio, created_at_ms, updated_at_ms, disabled_at_ms "
                        + "FROM `user` WHERE id = ?",
                profileMapper, id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int updateProfile(String id, String nickname, String bio, long updatedAtMs) {
        return jdbc.update(
                "UPDATE `user` SET nickname = ?, bio = ?, updated_at_ms = ? WHERE id = ?",
                nickname, bio, updatedAtMs, id);
    }

    public int setAvatar(String id, String avatarUrl, long updatedAtMs) {
        return jdbc.update(
                "UPDATE `user` SET avatar_url = ?, updated_at_ms = ? WHERE id = ?",
                avatarUrl, updatedAtMs, id);
    }

    /* ---------- F0 账号安全（P3/W4/W5） ---------- */

    public int updatePassword(String id, String passwordHash) {
        return jdbc.update("UPDATE `user` SET password_hash = ? WHERE id = ?", passwordHash, id);
    }

    /** 软注销：置位 disabled_at_ms；恢复只需清回 NULL（数据可恢复）。 */
    public int setDisabled(String id, long disabledAtMs) {
        return jdbc.update("UPDATE `user` SET disabled_at_ms = ? WHERE id = ?", disabledAtMs, id);
    }

    public int clearDisabled(String id) {
        return jdbc.update("UPDATE `user` SET disabled_at_ms = NULL WHERE id = ?", id);
    }

    /** 登录时判断是否已注销（独立于主实体映射，避免改动 User record 签名）。 */
    public Optional<Long> findDisabledAtMs(String userId) {
        Long v = jdbc.queryForObject(
                "SELECT disabled_at_ms FROM `user` WHERE id = ?", Long.class, userId);
        return v == null ? Optional.empty() : Optional.of(v);
    }
}
