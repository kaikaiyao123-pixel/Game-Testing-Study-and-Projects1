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
