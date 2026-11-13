-- 部署后校验：在 blog 库执行，table_count 期望 16。
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'blog'
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'blog';
