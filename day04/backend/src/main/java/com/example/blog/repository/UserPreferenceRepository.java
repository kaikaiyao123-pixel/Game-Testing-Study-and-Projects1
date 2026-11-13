package com.example.blog.repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.example.blog.foundation.common.RowMap;

/** F7 用户级偏好。与站点级 site_config 隔离，按 user_id 主键，天然不串号。 */
@Repository
public class UserPreferenceRepository {

    private static final int DEFAULT_PAGE_SIZE = 20;

    private final JdbcTemplate jdbc;

    public UserPreferenceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Map<String, Object>> find(String userId) {
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT * FROM user_preference WHERE user_id=?", (rs, n) -> RowMap.of(rs), userId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** 无偏好行时回退到表默认值，不改变任何既有列表接口的默认行为。 */
    public int pageSize(String userId) {
        if (userId == null) return DEFAULT_PAGE_SIZE;
        return find(userId).map(r -> RowMap.integer(r, "pageSize")).orElse(DEFAULT_PAGE_SIZE);
    }

    /** 内容作者的审核开关；未设置时返回 empty，由调用方回退到站点级配置。 */
    public Optional<Boolean> commentModeration(String ownerId) {
        if (ownerId == null) return Optional.empty();
        return find(ownerId).map(r -> RowMap.bool(r, "commentModeration"));
    }

    public void upsert(String userId, String siteName, String defaultVisibility, int pageSize,
                       String backgroundMode, boolean commentModeration, long updatedAtMs) {
        jdbc.update("INSERT INTO user_preference (user_id, site_name, default_visibility, page_size, "
                        + "background_mode, comment_moderation, updated_at_ms) VALUES (?,?,?,?,?,?,?) "
                        + "ON DUPLICATE KEY UPDATE site_name=VALUES(site_name), "
                        + "default_visibility=VALUES(default_visibility), page_size=VALUES(page_size), "
                        + "background_mode=VALUES(background_mode), "
                        + "comment_moderation=VALUES(comment_moderation), updated_at_ms=VALUES(updated_at_ms)",
                userId, siteName, defaultVisibility, pageSize, backgroundMode,
                commentModeration ? 1 : 0, updatedAtMs);
    }

    public int deleteByUser(String userId) {
        return jdbc.update("DELETE FROM user_preference WHERE user_id=?", userId);
    }
}
