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

/** F4 集合仓储。visibility 默认 private，写操作一律带 owner_id 条件。 */
@Repository
public class CollectionRepository {

    private final JdbcTemplate jdbc;

    public CollectionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }

    public void insert(Map<String, Object> m) {
        jdbc.update("INSERT INTO collection (id, owner_id, name, description, cover_url, visibility, "
                        + "share_password, sort_order, created_at_ms, updated_at_ms, deleted_at_ms) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                m.get("id"), m.get("ownerId"), m.get("name"), m.get("description"), m.get("coverUrl"),
                m.get("visibility"), m.get("sharePassword"), m.get("sortOrder"), m.get("createdAtMs"),
                m.get("updatedAtMs"), m.get("deletedAtMs"));
    }

    public int update(Map<String, Object> m) {
        return jdbc.update("UPDATE collection SET name=?, description=?, cover_url=?, visibility=?, "
                        + "share_password=?, sort_order=?, updated_at_ms=? "
                        + "WHERE id=? AND owner_id=? AND deleted_at_ms IS NULL",
                m.get("name"), m.get("description"), m.get("coverUrl"), m.get("visibility"),
                m.get("sharePassword"), m.get("sortOrder"), m.get("updatedAtMs"),
                m.get("id"), m.get("ownerId"));
    }

    public int softDelete(String id, String ownerId, long at) {
        return jdbc.update("UPDATE collection SET deleted_at_ms=?, updated_at_ms=? "
                + "WHERE id=? AND owner_id=? AND deleted_at_ms IS NULL", at, at, id, ownerId);
    }

    public Optional<Map<String, Object>> findById(String id) {
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT * FROM collection WHERE id=? AND deleted_at_ms IS NULL",
                (rs, n) -> RowMap.of(rs), id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<Map<String, Object>> list(boolean mine, String ownerId, PageQuery q) {
        if (mine) {
            return jdbc.query("SELECT * FROM collection WHERE deleted_at_ms IS NULL AND owner_id=? "
                            + "ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?",
                    (rs, n) -> RowMap.of(rs), ownerId, q.size(), q.offset());
        }
        return jdbc.query("SELECT * FROM collection WHERE deleted_at_ms IS NULL AND visibility='public' "
                        + "ORDER BY " + q.orderBy() + " LIMIT ? OFFSET ?",
                (rs, n) -> RowMap.of(rs), q.size(), q.offset());
    }

    public long count(boolean mine, String ownerId) {
        Long n = mine
                ? jdbc.queryForObject("SELECT COUNT(*) FROM collection WHERE deleted_at_ms IS NULL AND owner_id=?",
                        Long.class, ownerId)
                : jdbc.queryForObject("SELECT COUNT(*) FROM collection WHERE deleted_at_ms IS NULL AND visibility='public'",
                        Long.class);
        return n == null ? 0L : n;
    }

    public long countPublic() {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM collection WHERE deleted_at_ms IS NULL AND visibility='public'", Long.class);
        return n == null ? 0L : n;
    }

    public long countPublicItems() {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM collection_item ci "
                + "JOIN collection c ON c.id=ci.collection_id "
                + "WHERE ci.deleted_at_ms IS NULL AND c.deleted_at_ms IS NULL AND c.visibility='public'", Long.class);
        return n == null ? 0L : n;
    }

    public List<Map<String, Object>> recentPublic(int limit) {
        return jdbc.query("SELECT * FROM collection WHERE deleted_at_ms IS NULL AND visibility='public' "
                + "ORDER BY created_at_ms DESC LIMIT ?", (rs, n) -> RowMap.of(rs), limit);
    }

    /** 供主页聚合按 owner 统计（不区分可见性，作者自己的都算）。 */
    public long countByOwner(String ownerId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM collection WHERE deleted_at_ms IS NULL AND owner_id=?", Long.class, ownerId);
        return n == null ? 0L : n;
    }

    public List<String> idsOfOwner(String ownerId) {
        return jdbc.queryForList("SELECT id FROM collection WHERE owner_id=? AND deleted_at_ms IS NULL",
                String.class, ownerId);
    }
}
