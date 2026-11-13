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
