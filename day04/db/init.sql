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
