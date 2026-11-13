-- P3 特色模块 + 账号设置：5 张新表（幂等，可重复执行）
-- 依据 docs/功能实现方案.md §2（F3/F4/F5/F7）、§3 数据模型、docs/P3实施与验收方案.md W0。
-- 约束：不改动 db/init.sql 与 V1–V4；本文件只在 db/migrations/ 下新增。
-- 所有主键 UUID CHAR(36)，时间 epoch 毫秒 BIGINT，软删除用 deleted_at_ms。
-- 合规底线（决策 3）：media_item 只有「纯文本外链索引」字段，
--   没有任何文件本体 / object_key / mime / size / 播放源字段，验收脚本会自动断言。

USE `blog`;

-- F3 影视资源：个人观影资料库 / 外链索引（不托管文件本体）
CREATE TABLE IF NOT EXISTS `media_item` (
  `id`                    CHAR(36)      NOT NULL COMMENT 'UUID',
  `owner_id`              CHAR(36)      NOT NULL COMMENT 'user.id',
  `title`                 VARCHAR(200)  NOT NULL,
  `original_title`        VARCHAR(200)  DEFAULT NULL,
  `type`                  VARCHAR(16)   NOT NULL DEFAULT 'movie' COMMENT 'movie/series/anime/documentary',
  `year`                  INT           NOT NULL DEFAULT 0,
  `region`                VARCHAR(64)   DEFAULT NULL,
  `director`              VARCHAR(120)  DEFAULT NULL,
  `cast_summary`          VARCHAR(500)  DEFAULT NULL,
  `rating`                INT           DEFAULT NULL COMMENT '个人评分 0~10，NULL 表示未评分',
  `poster_url`            VARCHAR(512)  DEFAULT NULL COMMENT '封面 URL（纯文本，不上传文件）',
  `external_url`          VARCHAR(1024) DEFAULT NULL COMMENT '第三方纯文本索引，不做自动解析/跳转',
  `link_source`           VARCHAR(120)  DEFAULT NULL COMMENT '来源平台',
  `link_code`             VARCHAR(64)   DEFAULT NULL COMMENT '提取码（纯文本）',
  `link_status`           VARCHAR(16)   NOT NULL DEFAULT 'unchecked' COMMENT 'unchecked/valid/invalid',
  `link_checked_at_ms`    BIGINT        DEFAULT NULL,
  `link_recheck_after_ms` BIGINT        NOT NULL DEFAULT 0 COMMENT '低频探测退避：下次可检时间',
  `link_fail_count`       INT           NOT NULL DEFAULT 0 COMMENT '连续失效次数，用于指数退避',
  `watch_status`          VARCHAR(16)   NOT NULL DEFAULT 'want' COMMENT 'want/watching/watched',
  `watched_at_ms`         BIGINT        DEFAULT NULL,
  `progress`              VARCHAR(120)  DEFAULT NULL COMMENT '剧集进度，纯文本',
  `note`                  VARCHAR(1000) DEFAULT NULL,
  `visibility`            VARCHAR(16)   NOT NULL DEFAULT 'public' COMMENT 'public/private',
  `tags`                  VARCHAR(500)  DEFAULT NULL COMMENT 'JSON 字符串数组',
  `created_at_ms`         BIGINT        NOT NULL,
  `updated_at_ms`         BIGINT        DEFAULT NULL,
  `deleted_at_ms`         BIGINT        DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_business` (`title`, `year`, `type`, `deleted_at_ms`),
  KEY `idx_media_owner_status` (`owner_id`, `watch_status`, `created_at_ms`),
  KEY `idx_media_public` (`visibility`, `deleted_at_ms`, `created_at_ms`),
  KEY `idx_media_link_check` (`link_recheck_after_ms`, `deleted_at_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- F4 げん的宝库 · 集合（默认私有）
CREATE TABLE IF NOT EXISTS `collection` (
  `id`              CHAR(36)      NOT NULL,
  `owner_id`        CHAR(36)      NOT NULL,
  `name`            VARCHAR(120)  NOT NULL,
  `description`     VARCHAR(500)  DEFAULT NULL,
  `cover_url`       VARCHAR(512)  DEFAULT NULL,
  `visibility`      VARCHAR(16)   NOT NULL DEFAULT 'private' COMMENT 'private/public',
  `share_password`  VARCHAR(255)  DEFAULT NULL COMMENT '公开分享可选访问口令（PBKDF2 散列）',
  `sort_order`      INT           NOT NULL DEFAULT 0,
  `created_at_ms`   BIGINT        NOT NULL,
  `updated_at_ms`   BIGINT        DEFAULT NULL,
  `deleted_at_ms`   BIGINT        DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_collection_owner` (`owner_id`, `sort_order`),
  KEY `idx_collection_public` (`visibility`, `deleted_at_ms`, `created_at_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- F4 げん的宝库 · 条目
CREATE TABLE IF NOT EXISTS `collection_item` (
  `id`                    CHAR(36)      NOT NULL,
  `collection_id`         CHAR(36)      NOT NULL,
  `type`                  VARCHAR(16)   NOT NULL DEFAULT 'url' COMMENT 'url/image/text/file',
  `title`                 VARCHAR(200)  NOT NULL,
  `url`                   VARCHAR(1024) DEFAULT NULL,
  `thumbnail_url`         VARCHAR(512)  DEFAULT NULL,
  `note`                  VARCHAR(1000) DEFAULT NULL,
  `tags`                  VARCHAR(500)  DEFAULT NULL COMMENT 'JSON 字符串数组',
  `sort_order`            INT           NOT NULL DEFAULT 0,
  `link_status`           VARCHAR(16)   NOT NULL DEFAULT 'unchecked',
  `link_checked_at_ms`    BIGINT        DEFAULT NULL,
  `link_recheck_after_ms` BIGINT        NOT NULL DEFAULT 0,
  `link_fail_count`       INT           NOT NULL DEFAULT 0,
  `created_at_ms`         BIGINT        NOT NULL,
  `deleted_at_ms`         BIGINT        DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_collection_item_order` (`collection_id`, `sort_order`),
  KEY `idx_collection_item_check` (`link_recheck_after_ms`, `deleted_at_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- F5 碎碎念（游标时间线：created_at_ms + id）
CREATE TABLE IF NOT EXISTS `moment` (
  `id`              CHAR(36)     NOT NULL,
  `author_id`       CHAR(36)     NOT NULL,
  `content`         VARCHAR(500) NOT NULL,
  `images`          TEXT         DEFAULT NULL COMMENT 'JSON URL 数组，最多 9 张',
  `visibility`      VARCHAR(16)  NOT NULL DEFAULT 'public',
  `pinned`          TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at_ms`   BIGINT       NOT NULL,
  `deleted_at_ms`   BIGINT       DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_moment_author` (`author_id`, `created_at_ms`),
  KEY `idx_moment_timeline` (`visibility`, `deleted_at_ms`, `created_at_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- F7 用户级偏好（site_config 是站点级，用户级另建表）
CREATE TABLE IF NOT EXISTS `user_preference` (
  `user_id`             CHAR(36)     NOT NULL,
  `site_name`           VARCHAR(64)  DEFAULT NULL,
  `default_visibility`  VARCHAR(16)  NOT NULL DEFAULT 'public',
  `page_size`           INT          NOT NULL DEFAULT 20,
  `background_mode`     VARCHAR(16)  NOT NULL DEFAULT 'video',
  `comment_moderation`  TINYINT(1)   NOT NULL DEFAULT 1,
  `updated_at_ms`       BIGINT       NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
