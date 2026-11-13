package com.example.blog.repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.example.blog.foundation.common.CursorCodec;
import com.example.blog.foundation.common.RowMap;

/**
 * F5 碎碎念仓储。时间线游标严格基于 (created_at_ms, id) 复合比较，
 * 高频插入同一毫秒也不会重复或漏项；置顶项单独返回，不污染游标序列。
 */
@Repository
public class MomentRepository {

    private final JdbcTemplate jdbc;

    public MomentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }

    public void insert(Map<String, Object> m) {
        jdbc.update("INSERT INTO moment (id, author_id, content, images, visibility, pinned, "
                        + "created_at_ms, deleted_at_ms) VALUES (?,?,?,?,?,?,?,?)",
                m.get("id"), m.get("authorId"), m.get("content"), m.get("images"),
                m.get("visibility"), m.get("pinned"), m.get("createdAtMs"), m.get("deletedAtMs"));
    }

    public Optional<Map<String, Object>> findById(String id) {
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT * FROM moment WHERE id=? AND deleted_at_ms IS NULL",
                (rs, n) -> RowMap.of(rs), id);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public int update(String id, String authorId, String content, String images,
                      String visibility, int pinned) {
        return jdbc.update("UPDATE moment SET content=?, images=?, visibility=?, pinned=? "
                        + "WHERE id=? AND author_id=? AND deleted_at_ms IS NULL",
                content, images, visibility, pinned, id, authorId);
    }

    public int setPinned(String id, String authorId, int pinned) {
        return jdbc.update("UPDATE moment SET pinned=? WHERE id=? AND author_id=? AND deleted_at_ms IS NULL",
                pinned, id, authorId);
    }

    public int softDelete(String id, String authorId, long at) {
        return jdbc.update("UPDATE moment SET deleted_at_ms=? "
                + "WHERE id=? AND author_id=? AND deleted_at_ms IS NULL", at, id, authorId);
    }

    /** 多取一条用于判定 hasMore；不把置顶项混入游标序列。 */
    public List<Map<String, Object>> timeline(CursorCodec.Cursor before, int size, String viewerId) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder("SELECT * FROM moment WHERE deleted_at_ms IS NULL ");
        if (viewerId == null) {
            sql.append("AND visibility='public' ");
        } else {
            sql.append("AND (visibility='public' OR author_id=?) ");
            args.add(viewerId);
        }
        if (before != null) {
            sql.append("AND (created_at_ms < ? OR (created_at_ms = ? AND id < ?)) ");
            args.add(before.createdAtMs());
            args.add(before.createdAtMs());
            args.add(before.id());
        }
        sql.append("ORDER BY created_at_ms DESC, id DESC LIMIT ?");
        args.add(size + 1);
        return jdbc.query(sql.toString(), (rs, n) -> RowMap.of(rs), args.toArray());
    }

    public List<Map<String, Object>> pinnedVisible(String viewerId, int limit) {
        if (viewerId == null) {
            return jdbc.query("SELECT * FROM moment WHERE deleted_at_ms IS NULL AND pinned=1 "
                            + "AND visibility='public' ORDER BY created_at_ms DESC, id DESC LIMIT ?",
                    (rs, n) -> RowMap.of(rs), limit);
        }
        return jdbc.query("SELECT * FROM moment WHERE deleted_at_ms IS NULL AND pinned=1 "
                        + "AND (visibility='public' OR author_id=?) "
                        + "ORDER BY created_at_ms DESC, id DESC LIMIT ?",
                (rs, n) -> RowMap.of(rs), viewerId, limit);
    }

    public List<Map<String, Object>> archive(String viewerId) {
        String sql = "SELECT DATE_FORMAT(FROM_UNIXTIME(created_at_ms/1000), '%Y-%m') AS ym, "
                + "COUNT(*) AS cnt FROM moment WHERE deleted_at_ms IS NULL "
                + (viewerId == null ? "AND visibility='public' " : "AND (visibility='public' OR author_id=?) ")
                + "GROUP BY ym ORDER BY ym DESC";
        return viewerId == null
                ? jdbc.query(sql, (rs, n) -> RowMap.of(rs))
                : jdbc.query(sql, (rs, n) -> RowMap.of(rs), viewerId);
    }

    public long countPublic() {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM moment WHERE deleted_at_ms IS NULL AND visibility='public'", Long.class);
        return n == null ? 0L : n;
    }

    public List<Map<String, Object>> recentPublic(int limit) {
        return jdbc.query("SELECT * FROM moment WHERE deleted_at_ms IS NULL AND visibility='public' "
                + "ORDER BY created_at_ms DESC, id DESC LIMIT ?", (rs, n) -> RowMap.of(rs), limit);
    }

    public long countByAuthor(String authorId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM moment WHERE deleted_at_ms IS NULL AND author_id=?", Long.class, authorId);
        return n == null ? 0L : n;
    }
}
