package com.example.blog.repository;

import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.Reaction;

/** 点赞 / 收藏仓储（F8）。target_type + target_id + user_id + type 联合唯一，toggle 表达赞/取消。 */
@Repository
public class ReactionRepository {

    private final JdbcTemplate jdbc;

    public ReactionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean exists(String targetType, String targetId, String userId, String type) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM reaction WHERE target_type=? AND target_id=? AND user_id=? AND type=?",
                Long.class, targetType, targetId, userId, type);
        return n != null && n > 0;
    }

    /** 切换点赞状态：不存在则新增（返回 true），已存在则删除（返回 false）。 */
    public boolean toggle(String targetType, String targetId, String userId, String type) {
        if (exists(targetType, targetId, userId, type)) {
            jdbc.update(
                    "DELETE FROM reaction WHERE target_type=? AND target_id=? AND user_id=? AND type=?",
                    targetType, targetId, userId, type);
            return false;
        }
        jdbc.update(
                "INSERT INTO reaction (id, target_type, target_id, user_id, type, created_at_ms) VALUES (?,?,?,?,?,?)",
                UUID.randomUUID().toString(), targetType, targetId, userId, type, System.currentTimeMillis());
        return true;
    }

    public long countByTargetAndType(String targetType, String targetId, String type) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM reaction WHERE target_type=? AND target_id=? AND type=?",
                Long.class, targetType, targetId, type);
        return n == null ? 0L : n;
    }

    /** 批量返回某用户对一组目标的指定类型反应状态（用于列表页一次性判定「已赞」）。 */
    public java.util.Set<String> existsBatch(String targetType, String userId, String type, java.util.List<String> targetIds) {
        java.util.Set<String> result = new java.util.HashSet<>();
        if (targetIds == null || targetIds.isEmpty()) return result;
        String placeholders = String.join(",", targetIds.stream().map(id -> "?").toArray(String[]::new));
        jdbc.query(
                "SELECT target_id FROM reaction WHERE target_type=? AND user_id=? AND type=? AND target_id IN ("
                        + placeholders + ")",
                (rs, rn) -> result.add(rs.getString(1)),
                targetType, userId, type);
        return result;
    }
}
