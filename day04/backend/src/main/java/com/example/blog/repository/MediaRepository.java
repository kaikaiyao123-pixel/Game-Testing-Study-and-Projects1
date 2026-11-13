package com.example.blog.repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.RowMap;

/** F3 影视条目仓储。零托管文件：表中只有 URL 文本，不含任何文件本体字段。 */
@Repository
public class MediaRepository {

    private static final String COLUMNS = "id, owner_id, title, original_title, type, year, region, director, "
            + "cast_summary, rating, poster_url, external_url, link_source, link_code, link_status, "
            + "link_checked_at_ms, link_recheck_after_ms, link_fail_count, watch_status, watched_at_ms, "
            + "progress, note, visibility, tags, created_at_ms, updated_at_ms, deleted_at_ms";

    private final JdbcTemplate jdbc;

    public MediaRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }

    public void insert(Map<String, Object> m) {
        jdbc.update("INSERT INTO media_item (" + COLUMNS + ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                m.get("id"), m.get("ownerId"), m.get("title"), m.get("originalTitle"), m.get("type"),
                m.get("year"), m.get("region"), m.get("director"), m.get("castSummary"), m.get("rating"),
                m.get("posterUrl"), m.get("externalUrl"), m.get("linkSource"), m.get("linkCode"),
                m.get("linkStatus"), m.get("linkCheckedAtMs"), m.get("linkRecheckAfterMs"),
                m.get("linkFailCount"), m.get("watchStatus"), m.get("watchedAtMs"), m.get("progress"),
                m.get("note"), m.get("visibility"), m.get("tags"), m.get("createdAtMs"),
                m.get("updatedAtMs"), m.get("deletedAtMs"));
    }

    public int update(Map<String, Object> m) {
        return jdbc.update("UPDATE media_item SET title=?, original_title=?, type=?, year=?, region=?, "
                        + "director=?, cast_summary=?, rating=?, poster_url=?, external_url=?, link_source=?, "
                        + "link_code=?, link_status=?, link_checked_at_ms=?, link_recheck_after_ms=?, "
                        + "link_fail_count=?, watch_status=?, watched_at_ms=?, progress=?, note=?, "
                        + "visibility=?, tags=?, updated_at_ms=? "
                        + "WHERE id=? AND owner_id=? AND deleted_at_ms IS NULL",
                m.get("title"), m.get("originalTitle"), m.get("type"), m.get("year"), m.get("region"),
                m.get("director"), m.get("castSummary"), m.get("rating"), m.get("posterUrl"),
                m.get("externalUrl"), m.get("linkSource"), m.get("linkCode"), m.get("linkStatus"),
                m.get("linkCheckedAtMs"), m.get("linkRecheckAfterMs"), m.get("linkFailCount"),
                m.get("watchStatus"), m.get("watchedAtMs"), m.get("progress"), m.get("note"),
                m.get("visibility"), m.get("tags"), m.get("updatedAtMs"), m.get("id"), m.get("ownerId"));
    }

    public int softDelete(String id, String ownerId, long at) {
        return jdbc.update("UPDATE media_item SET deleted_at_ms=?, updated_at_ms=? "
                + "WHERE id=? AND owner_id=? AND deleted_at_ms IS NULL", at, at, id, ownerId);
    }

    public Optional<Map<String, Object>> findById(String id) {
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT * FROM media_item WHERE id=? AND deleted_at_ms IS NULL",
                (rs, n) -> RowMap.of(rs), id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** 业务去重（标题 + 年份 + 类型）；软删除行因 deleted_at_ms 非 NULL 不参与唯一约束。 */
    public boolean businessExists(String title, int year, String type, String excludeId) {
        String sql = "SELECT COUNT(*) FROM media_item WHERE title=? AND year=? AND type=? "
                + "AND deleted_at_ms IS NULL" + (excludeId == null ? "" : " AND id<>?");
        Long n = excludeId == null
                ? jdbc.queryForObject(sql, Long.class, title, year, type)
                : jdbc.queryForObject(sql, Long.class, title, year, type, excludeId);
        return n != null && n > 0;
    }

    public List<Map<String, Object>> list(Map<String, Object> f, PageQuery q) {
        List<Object> args = new ArrayList<>();
        String where = filterWhere(f, args);
        String sql = "SELECT * FROM media_item " + where + " ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?";
        args.add(q.size());
        args.add(q.offset());
        return jdbc.query(sql, (rs, n) -> RowMap.of(rs), args.toArray());
    }

    public long count(Map<String, Object> f) {
        List<Object> args = new ArrayList<>();
        String sql = "SELECT COUNT(*) FROM media_item " + filterWhere(f, args);
        Long n = jdbc.queryForObject(sql, Long.class, args.toArray());
        return n == null ? 0L : n;
    }

    private String filterWhere(Map<String, Object> f, List<Object> args) {
        StringBuilder sql = new StringBuilder("WHERE deleted_at_ms IS NULL ");
        if (Boolean.TRUE.equals(f.get("mine"))) {
            sql.append("AND owner_id=? ");
            args.add(f.get("ownerId"));
        } else {
            sql.append("AND visibility='public' ");
        }
        appendEq(sql, args, "type", f.get("type"));
        appendEq(sql, args, "watch_status", f.get("watchStatus"));
        appendEq(sql, args, "link_status", f.get("linkStatus"));
        appendEq(sql, args, "year", f.get("year"));
        if (f.get("ratingMin") != null) {
            sql.append("AND rating>=? ");
            args.add(f.get("ratingMin"));
        }
        Object text = f.get("q");
        if (text != null && !String.valueOf(text).isBlank()) {
            sql.append("AND (title LIKE ? OR original_title LIKE ? OR director LIKE ?) ");
            String like = String.valueOf(text).trim() + "%";
            args.add(like);
            args.add(like);
            args.add(like);
        }
        return sql.toString();
    }

    private static void appendEq(StringBuilder sql, List<Object> args, String column, Object value) {
        if (value == null || String.valueOf(value).isBlank()) return;
        sql.append("AND ").append(column).append("=? ");
        args.add(value);
    }

    public long countPublic() {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM media_item WHERE deleted_at_ms IS NULL AND visibility='public'", Long.class);
        return n == null ? 0L : n;
    }

    public long countByOwner(String ownerId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM media_item WHERE deleted_at_ms IS NULL AND owner_id=?", Long.class, ownerId);
        return n == null ? 0L : n;
    }

    public List<Map<String, Object>> recentPublic(int limit) {
        return jdbc.query("SELECT * FROM media_item WHERE deleted_at_ms IS NULL AND visibility='public' "
                + "ORDER BY created_at_ms DESC LIMIT ?", (rs, n) -> RowMap.of(rs), limit);
    }

    /** 低频探测：只取「到期的外链条目」，单批上限由调用方控制，避免高频外发请求。 */
    public List<Map<String, Object>> dueForLinkCheck(long now, int limit) {
        return jdbc.query("SELECT id, external_url, link_fail_count FROM media_item "
                        + "WHERE deleted_at_ms IS NULL AND external_url IS NOT NULL AND external_url<>'' "
                        + "AND link_recheck_after_ms<=? ORDER BY link_checked_at_ms ASC LIMIT ?",
                (rs, n) -> RowMap.of(rs), now, limit);
    }

    public int updateLinkCheck(String id, String status, long checkedAt, long recheckAfter, int failCount) {
        return jdbc.update("UPDATE media_item SET link_status=?, link_checked_at_ms=?, "
                        + "link_recheck_after_ms=?, link_fail_count=? WHERE id=?",
                status, checkedAt, recheckAfter, failCount, id);
    }
}
