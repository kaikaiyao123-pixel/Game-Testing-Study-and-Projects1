-- 自动生成，请勿手工编辑；重新生成：node deploy/db/build-cloud-init.js
-- 用途：新数据卷 / Zeabur 托管库的一次性建表（init.sql + V1..V5，共 16 张表）。
-- 幂等：建表均为 IF NOT EXISTS，加列走 information_schema 判定，可重复导入。
-- ===== db/init.sql =====
-- MySQL 容器首次启动时由 /docker-entrypoint-initdb.d 自动执行。
-- 时间统一用 epoch 毫秒（BIGINT），规避 MySQL DATETIME 经 JDBC / JVM 时区
-- 转换产生的 8 小时偏移；应用层对外仍输出 ISO-8601 字符串。

CREATE DATABASE IF NOT EXISTS `blog`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `blog`;

CREATE TABLE IF NOT EXISTS `user` (
  `id`               CHAR(36)     NOT NULL COMMENT 'UUID',
  `phone`            VARCHAR(20)  NOT NULL COMMENT '11 位手机号',
  `nickname`         VARCHAR(64)  NOT NULL,
  `password_hash`    VARCHAR(255) NOT NULL COMMENT 'pbkdf2$iterations$saltHex$hashHex',
  `created_at_ms`    BIGINT       NOT NULL COMMENT '注册时间，epoch 毫秒',
  `last_login_at_ms` BIGINT       NULL     COMMENT '最近登录时间，epoch 毫秒',
  `login_fails`      INT          NOT NULL DEFAULT 0,
  `locked_until_ms`  BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== db/migrations/V1__extend_user.sql =====
-- P0 地基 · V1：user 表字段扩展（幂等，可重复执行）
-- 依据 docs/功能实现方案.md §3 / F6 / P5 / F0-7。
-- 刻意不改动 db/init.sql：首次初始化逻辑保持原样，避免已有数据风险（§6 备份段）。
-- MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，故用 information_schema 判定 + 动态 SQL。

USE `blog`;

DROP PROCEDURE IF EXISTS `p0_add_column_if_missing`;

DELIMITER $$
CREATE PROCEDURE `p0_add_column_if_missing`(
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'user'
          AND COLUMN_NAME = p_column
    ) THEN
        SET @p0_ddl = CONCAT('ALTER TABLE `user` ADD COLUMN `', p_column, '` ', p_definition);
        PREPARE p0_stmt FROM @p0_ddl;
        EXECUTE p0_stmt;
        DEALLOCATE PREPARE p0_stmt;
    END IF;
END$$
DELIMITER ;

CALL `p0_add_column_if_missing`('avatar_url',      'VARCHAR(512) NULL COMMENT ''本地相对 URL，文件本体不入库''');
CALL `p0_add_column_if_missing`('bio',             'VARCHAR(500) NOT NULL DEFAULT '''' COMMENT ''个人简介''');
CALL `p0_add_column_if_missing`('updated_at_ms',   'BIGINT NULL COMMENT ''最近更新，epoch 毫秒''');
CALL `p0_add_column_if_missing`('deleted_at_ms',   'BIGINT NULL COMMENT ''软删除时间，NULL 表示未删除''');
CALL `p0_add_column_if_missing`('disabled_at_ms',  'BIGINT NULL COMMENT ''风控禁用时间，NULL 表示正常''');

DROP PROCEDURE IF EXISTS `p0_add_column_if_missing`;

-- 新增列全部为 NULL 或带 DEFAULT，既有 INSERT INTO `user` (显式列名列表) 不受影响。

-- ===== db/migrations/V2__p0_tables.sql =====
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

-- ===== db/migrations/V3__p2_tables.sql =====
-- P2 主干功能 + 互动：内容表与互动表（幂等，可重复执行）
-- 依据 docs/功能实现方案.md §3 数据模型总览 / F2 / F6 / F8 / F0-5。
-- 同样不改动 db/init.sql 与 V1/V2 迁移；user 字段已由 V1 扩展，site_config 由 V2 建立。
-- 所有主键 UUID CHAR(36)，时间 epoch 毫秒 BIGINT（P4 约定），软删除用 deleted_at_ms。

USE `blog`;

CREATE TABLE IF NOT EXISTS `article` (
  `id`              CHAR(36)     NOT NULL COMMENT 'UUID',
  `author_id`       CHAR(36)     NOT NULL COMMENT 'user.id',
  `title`           VARCHAR(200) NOT NULL,
  `slug`            VARCHAR(220) NOT NULL COMMENT '唯一，冲突追加序号',
  `summary`         VARCHAR(500) NOT NULL DEFAULT '' COMMENT '摘要，可由正文前 N 字生成',
  `content_md`      MEDIUMTEXT   COMMENT 'Markdown 原文（作者提交）',
  `content_html`    MEDIUMTEXT   COMMENT '服务端渲染并净化后的 HTML',
  `cover_url`       VARCHAR(512) DEFAULT NULL COMMENT '封面相对 URL，文件本体不入库',
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft/published/archived',
  `visibility`      VARCHAR(16)  NOT NULL DEFAULT 'public' COMMENT 'public/private',
  `category_id`     CHAR(36)     DEFAULT NULL,
  `view_count`      BIGINT       NOT NULL DEFAULT 0,
  `published_at_ms` BIGINT       DEFAULT NULL COMMENT '发布时间，epoch 毫秒',
  `created_at_ms`   BIGINT       NOT NULL,
  `updated_at_ms`   BIGINT       DEFAULT NULL,
  `deleted_at_ms`   BIGINT       DEFAULT NULL COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_article_slug` (`slug`),
  KEY `idx_article_author_status` (`author_id`, `status`, `published_at_ms`),
  KEY `idx_article_category` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `category` (
  `id`            CHAR(36) NOT NULL,
  `owner_id`      CHAR(36) NOT NULL COMMENT 'user.id',
  `name`          VARCHAR(60) NOT NULL,
  `slug`          VARCHAR(80) NOT NULL,
  `sort_order`    INT     NOT NULL DEFAULT 0,
  `created_at_ms` BIGINT  NOT NULL,
  `deleted_at_ms` BIGINT  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_category_owner_slug` (`owner_id`, `slug`),
  KEY `idx_category_owner` (`owner_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tag` (
  `id`            CHAR(36) NOT NULL,
  `name`          VARCHAR(40) NOT NULL,
  `slug`          VARCHAR(60) NOT NULL,
  `created_at_ms` BIGINT  NOT NULL,
  `deleted_at_ms` BIGINT  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tag_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `article_tag` (
  `article_id` CHAR(36) NOT NULL,
  `tag_id`     CHAR(36) NOT NULL,
  PRIMARY KEY (`article_id`, `tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `comment` (
  `id`            CHAR(36) NOT NULL COMMENT 'UUID',
  `target_type`   VARCHAR(16) NOT NULL COMMENT 'article/media/collection/moment',
  `target_id`     CHAR(36) NOT NULL,
  `author_id`     CHAR(36) NOT NULL COMMENT 'user.id（仅登录用户可发表）',
  `content`       VARCHAR(2000) NOT NULL,
  `status`        VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected',
  `parent_id`     CHAR(36)     DEFAULT NULL COMMENT '一层回复',
  `created_at_ms` BIGINT  NOT NULL,
  `deleted_at_ms` BIGINT  DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_comment_target` (`target_type`, `target_id`, `status`, `created_at_ms`),
  KEY `idx_comment_author` (`author_id`, `created_at_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reaction` (
  `id`            CHAR(36) NOT NULL,
  `target_type`   VARCHAR(16) NOT NULL COMMENT 'article/media/collection/moment',
  `target_id`     CHAR(36) NOT NULL,
  `user_id`       CHAR(36) NOT NULL COMMENT 'user.id',
  `type`          VARCHAR(16) NOT NULL COMMENT 'like/favorite',
  `created_at_ms` BIGINT  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reaction_target_user_type` (`target_type`, `target_id`, `user_id`, `type`),
  KEY `idx_reaction_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `share` (
  `id`             CHAR(36) NOT NULL,
  `target_type`    VARCHAR(16) NOT NULL COMMENT 'article/media/collection/moment',
  `target_id`      CHAR(36) NOT NULL,
  `token`          VARCHAR(64) NOT NULL COMMENT '随机 token，匿名持链接可读',
  `created_by`     CHAR(36) NOT NULL COMMENT 'user.id',
  `expires_at_ms`  BIGINT  DEFAULT NULL,
  `view_count`     BIGINT  NOT NULL DEFAULT 0,
  `created_at_ms`  BIGINT  NOT NULL,
  `revoked_at_ms`  BIGINT  DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_share_token` (`token`),
  KEY `idx_share_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `login_log` (
  `id`            CHAR(36) NOT NULL,
  `user_id`       CHAR(36) NOT NULL,
  `phone`         VARCHAR(20) DEFAULT NULL,
  `ip`            VARCHAR(64) DEFAULT NULL,
  `user_agent`    VARCHAR(512) DEFAULT NULL,
  `result`        VARCHAR(16) NOT NULL COMMENT 'success/failure',
  `reason`        VARCHAR(128) DEFAULT NULL,
  `created_at_ms` BIGINT  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_log_user` (`user_id`, `created_at_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== db/migrations/V4__p2_tag_index.sql =====
-- P2 补充：article_tag 需要一个反向索引（按 tag 反查文章已在 article_tag 主键
-- (article_id, tag_id) 之外的场景使用）。此处为详情页「按文章取标签名」保持
-- 主键前缀即可，无需额外索引；本脚本仅补充 tag.name 的查询索引以稳定排序成本。
--
-- 幂等：先查 information_schema 再建索引，可重复执行。
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'tag'
               AND index_name = 'idx_tag_name');
SET @sql := IF(@idx = 0,
  'ALTER TABLE `tag` ADD KEY `idx_tag_name` (`name`)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ===== db/migrations/V5__p3_tables.sql =====
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
