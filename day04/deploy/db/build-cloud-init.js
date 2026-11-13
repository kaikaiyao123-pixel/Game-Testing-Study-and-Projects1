'use strict';

/**
 * 生成云端一次性初始化脚本 cloud-init.sql。
 *
 * 按 db/init.sql -> V1 -> V2 -> V3 -> V4 -> V5 顺序只读拼接，
 * 不修改 db/ 下任何原文件（项目硬契约：禁改 init.sql 与 V1–V4）。
 *
 * 生成结果可直接：
 *  - 挂到 MySQL 官方镜像 /docker-entrypoint-initdb.d/ 自动执行，或
 *  - 用 mysql 客户端导入 Zeabur 托管数据库。
 *
 * 用法：
 *   node deploy/db/build-cloud-init.js              # 生成
 *   node deploy/db/build-cloud-init.js --selftest   # 反向测试，证明自检不是空壳
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'cloud-init.sql');
const SOURCES = [
  'db/init.sql',
  'db/migrations/V1__extend_user.sql',
  'db/migrations/V2__p0_tables.sql',
  'db/migrations/V3__p2_tables.sql',
  'db/migrations/V4__p2_tag_index.sql',
  'db/migrations/V5__p3_tables.sql',
];

const EXPECTED_TABLES = 16; // init 1 + V2 2 + V3 8 + V5 5

function assertSql(text) {
  const tables = (text.match(/CREATE TABLE IF NOT EXISTS/g) || []).length;
  if (tables !== EXPECTED_TABLES) {
    throw new Error(`期望 ${EXPECTED_TABLES} 处 CREATE TABLE IF NOT EXISTS，实际 ${tables}`);
  }

  // V1 用 DELIMITER $$ 定义存储过程；配对失败会让 mysql 客户端把后续语句整体吞掉。
  const opened = (text.match(/^DELIMITER \$\$/gm) || []).length;
  const closed = (text.match(/^DELIMITER ;/gm) || []).length;
  if (opened !== closed) {
    throw new Error(`DELIMITER 不配对：开 ${opened} / 闭 ${closed}`);
  }

  // 保证迁移顺序没有被意外打乱（V1 的加列必须先于 V2 的建表）。
  let cursor = -1;
  for (const rel of SOURCES) {
    const at = text.indexOf(`-- ===== ${rel} =====`);
    if (at < 0 || at <= cursor) {
      throw new Error(`源文件缺失或顺序错乱：${rel}`);
    }
    cursor = at;
  }
  return tables;
}

const parts = SOURCES.map((rel) => {
  const abs = path.join(ROOT, rel);
  const text = fs.readFileSync(abs, 'utf8');
  if (!text.trim()) throw new Error(`源文件为空：${rel}`);
  return `-- ===== ${rel} =====\n${text.trimEnd()}\n`;
});

const banner = [
  '-- 自动生成，请勿手工编辑；重新生成：node deploy/db/build-cloud-init.js',
  '-- 用途：新数据卷 / Zeabur 托管库的一次性建表（init.sql + V1..V5，共 16 张表）。',
  '-- 幂等：建表均为 IF NOT EXISTS，加列走 information_schema 判定，可重复导入。',
  '',
].join('\n');

const sql = `${banner}${parts.join('\n')}`;

if (process.argv.includes('--selftest')) {
  const cases = [
    ['删掉一处建表语句', sql.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TABLE')],
    ['打乱 DELIMITER 配对', sql.replace('DELIMITER ;', 'DELIMITER !!')],
    ['丢失某个源文件标记', sql.replace('-- ===== db/migrations/V3__p2_tables.sql =====', '-- (missing)')],
  ];
  for (const [name, bad] of cases) {
    let caught = false;
    try { assertSql(bad); } catch (err) { caught = true; }
    if (!caught) throw new Error(`反向测试失败：自检未捕获「${name}」`);
    console.log(`  PASS 反向注入：${name}`);
  }
  assertSql(sql);
  console.log('[build-cloud-init] 反向测试通过');
  process.exit(0);
}

const count = assertSql(sql);
fs.writeFileSync(OUT, sql, 'utf8');
console.log(`[build-cloud-init] ${SOURCES.length} 个源文件 -> deploy/db/cloud-init.sql，${count} 张表，${sql.split('\n').length} 行`);
