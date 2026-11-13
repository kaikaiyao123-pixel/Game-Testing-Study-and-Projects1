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
