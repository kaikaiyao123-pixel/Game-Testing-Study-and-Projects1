-- P0 地基 · V2：站点配置表 + 上传元数据表（幂等，可重复执行）
-- 依据 docs/功能实现方案.md §3 数据模型总览 / §4.2 / §6 / §11 决策 4 建议。
-- 同样不改动 db/init.sql。

USE `blog`;

CREATE TABLE IF NOT EXISTS `site_config` (
  `config_key`    VARCHAR(64)   NOT NULL COMMENT '配置键',
  `config_value`  VARCHAR(1024) NOT NULL COMMENT '配置值',
  `updated_at_ms` BIGINT        NOT NULL COMMENT 'epoch 毫秒',
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `upload` (
  `id`            CHAR(36)     NOT NULL COMMENT 'UUID',
  `owner_id`      CHAR(36)     NOT NULL COMMENT '上传者 user.id',
  `object_key`    VARCHAR(128) NOT NULL COMMENT '服务端重命名后的文件名',
  `url`           VARCHAR(512) NOT NULL COMMENT '相对 URL，由 8081 提供',
  `mime`          VARCHAR(64)  NOT NULL,
  `size_bytes`    BIGINT       NOT NULL,
  `created_at_ms` BIGINT       NOT NULL COMMENT 'epoch 毫秒',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_upload_object_key` (`object_key`),
  KEY `idx_upload_owner` (`owner_id`, `created_at_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @p0_now_ms = ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000);

-- INSERT IGNORE 保证重复执行不会覆盖运维在 F7 阶段改过的配置值。
INSERT IGNORE INTO `site_config` (`config_key`, `config_value`, `updated_at_ms`) VALUES
  ('site.name',                '炫与梓',       @p0_now_ms),
  ('site.tagline',             '记录生活，收藏喜欢', @p0_now_ms),
  ('site.default-visibility',  'public',       @p0_now_ms),
  ('site.page-size',           '20',           @p0_now_ms),
  ('site.comment-moderation',  'true',         @p0_now_ms);
