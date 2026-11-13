package com.example.blog.foundation.repository;

import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 站点配置表读取（V2 迁移脚本建立）。
 * 表尚未迁移 / 数据库暂不可用时优雅回退到 SiteProperties 默认值，
 * 保证「严格零改动、未执行迁移」时应用仍可启动、端点仍可返回 200。
 */
@Repository
public class SiteConfigStore {

    private final JdbcTemplate jdbc;

    public SiteConfigStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<String> find(String key) {
        if (key == null || key.isBlank()) return Optional.empty();
        try {
            return jdbc.query(
                    "SELECT `config_value` FROM `site_config` WHERE `config_key` = ? LIMIT 1",
                    rs -> rs.next() ? Optional.of(rs.getString(1)) : Optional.empty(),
                    key);
        } catch (Exception ex) {
            return Optional.empty();
        }
    }
}
