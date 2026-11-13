package com.example.blog.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.Category;

/** 分类仓储（F2）。归属作者，slug 在作者范围内唯一。 */
@Repository
public class CategoryRepository {

    private final JdbcTemplate jdbc;

    private final RowMapper<Category> mapper = (rs, rowNum) -> new Category(
            rs.getString("id"),
            rs.getString("owner_id"),
            rs.getString("name"),
            rs.getString("slug"),
            rs.getInt("sort_order"),
            rs.getLong("created_at_ms"),
            nullableLong(rs, "deleted_at_ms"));

    public CategoryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    public void insert(Category c) {
        jdbc.update(
                "INSERT INTO category (id, owner_id, name, slug, sort_order, created_at_ms) "
                        + "VALUES (?,?,?,?,?,?)",
                c.id(), c.ownerId(), c.name(), c.slug(), c.sortOrder(), c.createdAtMs());
    }

    public int update(Category c) {
        return jdbc.update(
                "UPDATE category SET name=?, slug=?, sort_order=? WHERE id=? AND owner_id=? AND deleted_at_ms IS NULL",
                c.name(), c.slug(), c.sortOrder(), c.id(), c.ownerId());
    }

    public int softDelete(String id, String ownerId, long deletedAtMs) {
        return jdbc.update(
                "UPDATE category SET deleted_at_ms=? WHERE id=? AND owner_id=? AND deleted_at_ms IS NULL",
                deletedAtMs, id, ownerId);
    }

    public List<Category> listByOwner(String ownerId) {
        return jdbc.query(
                "SELECT * FROM category WHERE owner_id=? AND deleted_at_ms IS NULL ORDER BY sort_order ASC, created_at_ms ASC",
                mapper, ownerId);
    }

    public Optional<Category> findByIdAndOwner(String id, String ownerId) {
        List<Category> rows = jdbc.query(
                "SELECT * FROM category WHERE id=? AND owner_id=? AND deleted_at_ms IS NULL", mapper, id, ownerId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public boolean existsBySlugAndOwner(String slug, String ownerId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM category WHERE slug=? AND owner_id=? AND deleted_at_ms IS NULL",
                Long.class, slug, ownerId);
        return n != null && n > 0;
    }

    public String nextId() {
        return UUID.randomUUID().toString();
    }
}
