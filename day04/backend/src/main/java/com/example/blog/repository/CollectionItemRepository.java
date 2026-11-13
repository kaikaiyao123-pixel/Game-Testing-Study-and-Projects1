package com.example.blog.repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.RowMap;

/** F4 条目仓储：排序、批量移动、标签筛选、外链失效检测。 */
@Repository
public class CollectionItemRepository {

    private final JdbcTemplate jdbc;

    public CollectionItemRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }

    public int nextSortOrder(String collectionId) {
        Long n = jdbc.queryForObject(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collection_item WHERE collection_id=? "
                        + "AND deleted_at_ms IS NULL", Long.class, collectionId);
        return n == null ? 1 : n.intValue();
    }

    public void insert(Map<String, Object> m) {
        jdbc.update("INSERT INTO collection_item (id, collection_id, type, title, url, thumbnail_url, "
                        + "note, tags, sort_order, link_status, link_checked_at_ms, "
                        + "link_recheck_after_ms, link_fail_count, created_at_ms, deleted_at_ms) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                m.get("id"), m.get("collectionId"), m.get("type"), m.get("title"), m.get("url"),
                m.get("thumbnailUrl"), m.get("note"), m.get("tags"), m.get("sortOrder"),
                m.get("linkStatus"), m.get("linkCheckedAtMs"), m.get("linkRecheckAfterMs"),
                m.get("linkFailCount"), m.get("createdAtMs"), m.get("deletedAtMs"));
    }

    public Optional<Map<String, Object>> findById(String id) {
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT * FROM collection_item WHERE id=? AND deleted_at_ms IS NULL",
                (rs, n) -> RowMap.of(rs), id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<Map<String, Object>> list(String collectionId, String tag, PageQuery q) {
        StringBuilder sql = new StringBuilder(
                "SELECT * FROM collection_item WHERE collection_id=? AND deleted_at_ms IS NULL ");
        java.util.List<Object> args = new java.util.ArrayList<>();
        args.add(collectionId);
        if (tag != null && !tag.isBlank()) {
            sql.append("AND tags LIKE ? ");
            args.add("%\"" + tag.trim() + "\"%");
        }
        // 排序固定用 sort_order:asc，避免 q.orderBy() 引入与拖拽顺序不一致的列
        sql.append("ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?");
        args.add(q.size());
        args.add(q.offset());
        return jdbc.query(sql.toString(), (rs, n) -> RowMap.of(rs), args.toArray());
    }

    public long count(String collectionId, String tag) {
        if (tag == null || tag.isBlank()) {
            Long n = jdbc.queryForObject("SELECT COUNT(*) FROM collection_item "
                    + "WHERE collection_id=? AND deleted_at_ms IS NULL", Long.class, collectionId);
            return n == null ? 0L : n;
        }
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM collection_item "
                        + "WHERE collection_id=? AND deleted_at_ms IS NULL AND tags LIKE ?",
                Long.class, collectionId, "%\"" + tag.trim() + "\"%");
        return n == null ? 0L : n;
    }

    /** 按有序 id 数组落库：仅更新属于该集合的条目，返回成功条数。 */
    public int applyOrder(String collectionId, List<String> ids) {
        int changed = 0;
        for (int i = 0; i < ids.size(); i++) {
            changed += jdbc.update("UPDATE collection_item SET sort_order=? "
                    + "WHERE id=? AND collection_id=? AND deleted_at_ms IS NULL", i + 1, ids.get(i), collectionId);
        }
        return changed;
    }

    public int moveItems(String fromId, String toId, List<String> ids) {
        int changed = 0;
        for (String id : ids) {
            changed += jdbc.update("UPDATE collection_item SET collection_id=? "
                    + "WHERE id=? AND collection_id=? AND deleted_at_ms IS NULL", toId, id, fromId);
        }
        return changed;
    }

    public int softDelete(String id, String collectionId, long at) {
        return jdbc.update("UPDATE collection_item SET deleted_at_ms=? "
                + "WHERE id=? AND collection_id=? AND deleted_at_ms IS NULL", at, id, collectionId);
    }

    public int updateItem(Map<String, Object> m) {
        return jdbc.update("UPDATE collection_item SET type=?, title=?, url=?, thumbnail_url=?, "
                        + "note=?, tags=? WHERE id=? AND collection_id=? AND deleted_at_ms IS NULL",
                m.get("type"), m.get("title"), m.get("url"), m.get("thumbnailUrl"),
                m.get("note"), m.get("tags"), m.get("id"), m.get("collectionId"));
    }

    public int countByCollection(String collectionId) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM collection_item "
                + "WHERE collection_id=? AND deleted_at_ms IS NULL", Long.class, collectionId);
        return n == null ? 0 : n.intValue();
    }

    public List<Map<String, Object>> dueForLinkCheck(long now, int limit) {
        return jdbc.query("SELECT ci.id, ci.url, ci.link_fail_count FROM collection_item ci "
                        + "JOIN collection c ON c.id=ci.collection_id "
                        + "WHERE ci.deleted_at_ms IS NULL AND c.deleted_at_ms IS NULL AND ci.type='url' "
                        + "AND ci.url IS NOT NULL AND ci.url<>'' AND ci.link_recheck_after_ms<=? "
                        + "ORDER BY ci.link_checked_at_ms ASC LIMIT ?",
                (rs, n) -> RowMap.of(rs), now, limit);
    }

    public int updateLinkCheck(String id, String status, long checkedAt, long recheckAfter, int failCount) {
        return jdbc.update("UPDATE collection_item SET link_status=?, link_checked_at_ms=?, "
                        + "link_recheck_after_ms=?, link_fail_count=? WHERE id=?",
                status, checkedAt, recheckAfter, failCount, id);
    }
}
