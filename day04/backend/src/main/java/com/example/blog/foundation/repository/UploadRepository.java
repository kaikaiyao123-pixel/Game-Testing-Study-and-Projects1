package com.example.blog.foundation.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * upload 元数据表（V2 迁移脚本建立）。文件本体不入库，只存相对 URL 与对象键（P7）。
 * 全部使用 JdbcTemplate 参数化占位符，不拼接任何用户输入。
 */
@Repository
public class UploadRepository {

    public record Record(String objectKey, String ownerId, String url,
                         String mime, long sizeBytes, long createdAtMs) {
    }

    private final JdbcTemplate jdbc;

    public UploadRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void save(Record record) {
        jdbc.update(
                "INSERT INTO `upload` (`id`,`owner_id`,`object_key`,`url`,`mime`,`size_bytes`,`created_at_ms`) "
                        + "VALUES (?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), record.ownerId(), record.objectKey(), record.url(),
                record.mime(), record.sizeBytes(), record.createdAtMs());
    }

    public Optional<Record> findByKey(String objectKey) {
        if (objectKey == null || objectKey.isBlank() || objectKey.length() > 128) {
            return Optional.empty();
        }
        try {
            return jdbc.query(
                    "SELECT `object_key`,`owner_id`,`url`,`mime`,`size_bytes`,`created_at_ms` "
                            + "FROM `upload` WHERE `object_key` = ? LIMIT 1",
                    rs -> rs.next() ? Optional.of(new Record(
                            rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                            rs.getLong(5), rs.getLong(6))) : Optional.empty(),
                    objectKey);
        } catch (Exception ex) {
            return Optional.empty();
        }
    }
}
