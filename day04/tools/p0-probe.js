'use strict';

/**
 * P0 地基验收探针（零外部依赖，仅用 Node 内置 fetch / FormData / crypto）。
 *
 * 覆盖四层：
 *   1. 源码基线完整性 —— 比对 p0-baseline.json 中 57 个既有源码文件的 SHA256。
 *      P1 阶段用户已授权修改既有文件，「严格零改动」约束解除，基线语义转为
 *      「源码连续性」（P0 精确零改动基线归档在 p0Snapshot 字段，供追溯）。
 *      验收脚本每次重写的 UI 截图 / SQL 备份产物已在基线中明确排除；
 *   2. 迁移落地证明 —— information_schema 核对新增列与新增表；
 *   3. 现有 5 个鉴权 API 契约回归 + 新增 P0 端点端到端
 *      （匿名读 200 / 未登录写 401 / 越权 404 / 上传三重白名单 / 静态读取）；
 *   4. 反向注入 —— 注入已知错误，证明本探针的判定逻辑不是「永远通过」的空壳。
 *
 * 用法: node tools/p0-probe.js
 *      BLOG_API_BASE=http://127.0.0.1:8082 node tools/p0-probe.js
 * 前置: MySQL / Redis 就绪，后端已用含 P0 类的 fat jar 启动，迁移脚本已执行。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API = process.env.BLOG_API_BASE || 'http://127.0.0.1:8081';
const BASELINE = path.join(__dirname, 'p0-baseline.json');
const EXPECTED_SITE_NAME = '炫与梓';

let passed = 0;
const failures = [];

function check(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    const line = label + (extra ? ' | ' + extra : '');
    failures.push(line);
    console.log('  FAIL  ' + line);
  }
  return !!condition;
}

/* ---------- 判定函数：主流程与反向注入共用，确保反向测试测的是同一套逻辑 ---------- */
function statusMatches(actual, expected) {
  return actual === expected;
}

function configNameMatches(data, expectedName) {
  return !!data && typeof data.siteName === 'string' && data.siteName === expectedName;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function baselineDiffs(expected, actual) {
  const diffs = [];
  for (const rel of Object.keys(expected)) {
    if (actual[rel] !== expected[rel]) diffs.push(rel);
  }
  return diffs;
}

/* ---------- 环境辅助 ---------- */
function envValue(key, fallback) {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return fallback;
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .find((item) => item.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim() : fallback;
}

function mysqlExec(sql) {
  const pwd = envValue('MYSQL_ROOT_PASSWORD', 'blog_root_2026');
  return cp.execFileSync('docker', ['exec', 'blogg-mysql', 'mysql',
    '--default-character-set=utf8mb4', '-uroot', '-p' + pwd, '-N', '-e', sql],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/* ---------- HTTP ---------- */
async function req(pathname, options) {
  const response = await fetch(API + pathname, options);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (err) { body = null; }
  return { status: response.status, body, text, headers: response.headers };
}

async function rawGet(pathname) {
  const response = await fetch(API + pathname);
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers };
}

function jsonPost(pathname, data, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return req(pathname, { method: 'POST', headers, body: JSON.stringify(data) });
}

function authGet(pathname, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  return req(pathname, { headers });
}

function uploadFile(filename, contentType, bytes, token) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  // 不手工设置 Content-Type，让 fetch 自动生成带 boundary 的 multipart 头
  return req('/api/uploads', { method: 'POST', headers, body: form });
}

function phoneOf(seq) {
  return '199' + String(Date.now()).slice(-6) + String(seq).padStart(2, '0');
}

/* ---------- 测试夹具：1x1 合法 PNG ---------- */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const PNG_MAGIC = '89504e470d0a1a0a';

/* ---------- 反向注入 ---------- */
function runReverseTests(baseline, actualHashes) {
  console.log('\n--- 反向注入（证明探针不是永远通过的空壳） ---');
  const firstKey = Object.keys(baseline.files)[0];

  // 注入 1：内存中篡改一个哈希，比对逻辑必须检出
  const tampered = Object.assign({}, actualHashes);
  tampered[firstKey] = '0'.repeat(64);
  check(baselineDiffs(baseline.files, tampered).length > 0,
    '反向注入：篡改的既有文件哈希可被检出');

  // 注入 2：错误品牌名期望，主流程共用的判定函数必须返回 false
  check(configNameMatches({ siteName: EXPECTED_SITE_NAME }, EXPECTED_SITE_NAME),
    '正向对照：正确品牌名判定通过');
  check(!configNameMatches({ siteName: EXPECTED_SITE_NAME }, '不存在的品牌名'),
    '反向注入：错误品牌名期望可被检出');

  // 注入 3：错误状态码期望，主流程共用的判定函数必须返回 false
  check(!statusMatches(404, 200), '反向注入：越权用例的错误状态码期望可被检出');

  // 注入 4：真实临时文件 —— 写入被篡改的基线副本，确认文件级注入同样被检出
  const tmp = path.join(__dirname, '_p0_reverse_baseline.json');
  const injected = JSON.parse(JSON.stringify(baseline));
  injected.files[firstKey] = 'f'.repeat(64);
  fs.writeFileSync(tmp, JSON.stringify(injected, null, 2), 'utf8');
  try {
    const fromFile = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    check(baselineDiffs(baseline.files, fromFile.files).length > 0,
      '反向注入：临时文件级篡改可被检出');
  } finally {
    fs.unlinkSync(tmp);
  }
  check(!fs.existsSync(tmp), '反向注入临时文件已清理');
}

/* ---------- 主流程 ---------- */
async function main() {
  console.log('================ P0 地基验收探针 ================');
  console.log('目标实例: ' + API);
  console.log('');

  const createdPhones = [];
  const password = 'P0probe@2026';

  /* 1. 源码基线完整性（P1 授权后已从「严格零改动」转为「源码连续性」基线） */
  console.log('--- 1. 源码基线完整性（P1 授权后已刷新） ---');
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const actualHashes = {};
  for (const rel of Object.keys(baseline.files)) {
    const file = path.join(ROOT, rel);
    actualHashes[rel] = fs.existsSync(file) ? sha256(file) : '<MISSING>';
  }
  const diffs = baselineDiffs(baseline.files, actualHashes);
  check(diffs.length === 0,
    '源码基线与当前一致：' + baseline.fileCount + ' 个既有文件 SHA256 全部一致',
    diffs.length ? 'diffs=' + diffs.slice(0, 5).join(', ') : '');
  check(baseline.fileCount >= 50, '源码基线覆盖足够多的既有文件',
    'count=' + baseline.fileCount);

  /* 2. 迁移脚本落地证明 */
  console.log('\n--- 2. 迁移脚本落地证明 ---');
  let columns = '';
  let tables = '';
  try {
    columns = mysqlExec("SELECT COLUMN_NAME FROM information_schema.columns "
      + "WHERE table_schema='blog' AND table_name='user';");
    tables = mysqlExec("SELECT table_name FROM information_schema.tables WHERE table_schema='blog';");
  } catch (err) {
    check(false, '可通过 Docker MySQL 查询 information_schema', String(err.message).split('\n')[0]);
  }
  const colList = columns.split(/\r?\n/).map((s) => s.trim());
  for (const col of ['avatar_url', 'bio', 'updated_at_ms', 'deleted_at_ms', 'disabled_at_ms']) {
    check(colList.includes(col), 'V1 迁移：user 表新增列 ' + col);
  }
  check(tables.includes('site_config'), 'V2 迁移：site_config 表存在');
  check(tables.includes('upload'), 'V2 迁移：upload 表存在');

  /* 3. 夹具自检 */
  console.log('\n--- 3. 夹具自检 ---');
  check(PNG.slice(0, 8).toString('hex') === PNG_MAGIC, '测试夹具是合法 PNG（魔数正确）');

  /* 4. 现有 5 个 API 契约回归 */
  console.log('\n--- 4. 现有 5 个鉴权 API 契约回归 ---');
  let r = await req('/api/health');
  check(r.status === 200 && r.body && r.body.ok === true && r.body.storage === 'mysql+redis',
    'GET /api/health 回归：200 且声明 mysql+redis', JSON.stringify(r.body));

  const phoneA = phoneOf(71);
  const phoneB = phoneOf(72);
  r = await jsonPost('/api/register', { phone: phoneA, nickname: 'p0userA', password });
  check(r.status === 201 && r.body && r.body.ok === true && r.body.user && r.body.user.phone === phoneA,
    'POST /api/register 回归：201 且返回 user.phone', 'status=' + r.status);
  createdPhones.push(phoneA);

  r = await jsonPost('/api/register', { phone: phoneB, nickname: 'p0userB', password });
  check(r.status === 201 && r.body && r.body.ok === true, '注册第二个账号 B（越权用例用）',
    'status=' + r.status);
  createdPhones.push(phoneB);

  r = await jsonPost('/api/login', { phone: phoneA, password });
  check(r.status === 200 && r.body && typeof r.body.token === 'string' && r.body.token.length >= 32,
    'POST /api/login 回归：签发 token', 'status=' + r.status);
  const tokenA = r.body && r.body.token;

  r = await jsonPost('/api/login', { phone: phoneB, password });
  const tokenB = r.body && r.body.token;
  check(r.status === 200 && !!tokenB, '账号 B 登录成功', 'status=' + r.status);

  r = await authGet('/api/me', tokenA);
  check(r.status === 200 && r.body && r.body.user && r.body.user.phone === phoneA,
    'GET /api/me 回归：返回当前用户', 'status=' + r.status);

  /* 5. 公开读 / 访客态 */
  console.log('\n--- 5. 公开读与访客态（决策 2 / P9） ---');
  r = await req('/api/site/config');
  check(statusMatches(r.status, 200), '匿名读 /api/site/config 返回 200 而非 401',
    'status=' + r.status);
  const cfg = r.body && r.body.data;
  check(r.body && r.body.ok === true && !!cfg, '站点配置符合 {ok,data} 契约');
  check(configNameMatches(cfg, EXPECTED_SITE_NAME), '站点配置品牌名为「炫与梓」',
    cfg ? String(cfg.siteName) : 'data=null');
  check(cfg && cfg.visitor === true, '匿名态 visitor=true（拦截器访客注入生效）');
  check(cfg && cfg.defaultVisibility === 'public', '默认可见性为 public');
  check(cfg && cfg.pageSize === 20, '默认分页大小为 20');

  r = await authGet('/api/site/config', tokenA);
  check(r.status === 200 && r.body && r.body.data && r.body.data.visitor === false,
    '登录态 visitor=false（拦截器正确解析 Bearer 并注入 userId）',
    'status=' + r.status);

  r = await req('/api/not-exist');
  check(r.status === 404 && r.body && r.body.ok === false,
    '既有 JSON 404 fallback 未被新增路由破坏', 'status=' + r.status);

  r = await req('/api/site/config', {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:3000', 'Access-Control-Request-Method': 'GET' },
  });
  check((r.status === 200 || r.status === 204)
    && (r.headers.get('access-control-allow-origin') || '').length > 0,
    '既有 CORS 规则覆盖新增公开端点', 'status=' + r.status);

  /* 6. 上传端点：鉴权 */
  console.log('\n--- 6. 上传端点鉴权与错误码 ---');
  r = await uploadFile('a.png', 'image/png', PNG, null);
  check(statusMatches(r.status, 401), '未登录上传返回 401', 'status=' + r.status);
  check(r.body && r.body.ok === false && r.body.code === 'UNAUTHORIZED',
    '失败响应携带统一错误码 code=UNAUTHORIZED', r.text.slice(0, 160));

  r = await uploadFile('a.png', 'image/png', PNG, 'forged-token-xxxxxxxx');
  check(statusMatches(r.status, 401), '伪造令牌上传返回 401', 'status=' + r.status);

  /* 7. 上传端点：三重白名单 */
  console.log('\n--- 7. 上传端点三重白名单 ---');
  r = await uploadFile('evil.exe', 'image/png', PNG, tokenA);
  check(statusMatches(r.status, 400), '非法扩展名被拒绝 (400)', 'status=' + r.status);

  r = await uploadFile('mismatch.png', 'text/plain', PNG, tokenA);
  check(statusMatches(r.status, 400), 'MIME 与扩展名不匹配被拒绝 (400)', 'status=' + r.status);

  r = await uploadFile('fake.png', 'image/png', Buffer.from('this is not a png'), tokenA);
  check(statusMatches(r.status, 400), '扩展名/MIME 合法但魔数不符被拒绝 (400)', 'status=' + r.status);

  const oversized = Buffer.alloc(Math.round(2.5 * 1024 * 1024), 0x41);
  r = await uploadFile('big.png', 'image/png', oversized, tokenA);
  check(statusMatches(r.status, 400), '超过 2 MB 的文件被拒绝 (400)', 'status=' + r.status);

  /* 8. 合法上传 + 防目录穿越 + 静态读取 */
  console.log('\n--- 8. 合法上传与静态读取 ---');
  r = await uploadFile('../../evil.png', 'image/png', PNG, tokenA);
  check(statusMatches(r.status, 200), '客户端文件名含 ../ 仍按白名单正常上传（服务端重命名）',
    'status=' + r.status);
  const uploadData = r.body && r.body.data;
  const objectKey = uploadData && uploadData.objectKey;
  check(!!objectKey && !objectKey.includes('..') && !objectKey.includes('/')
    && !objectKey.includes('\\'), 'objectKey 为纯 UUID 文件名，目录穿越被消除',
    'objectKey=' + objectKey);
  check(uploadData && uploadData.url === '/uploads/' + objectKey,
    '返回相对 URL（由 8081 提供）', uploadData ? uploadData.url : 'data=null');
  check(uploadData && uploadData.mime === 'image/png' && uploadData.sizeBytes === PNG.length,
    '返回 mime / sizeBytes 与上传一致');

  let raw = await rawGet('/uploads/' + objectKey);
  check(raw.status === 200 && raw.bytes.equals(PNG),
    'GET /uploads/<key> 静态映射返回与上传完全一致的字节',
    'status=' + raw.status + ' len=' + raw.bytes.length);

  raw = await rawGet('/uploads/definitely-not-exists.png');
  check(statusMatches(raw.status, 404), '不存在的静态资源返回 404', 'status=' + raw.status);

  /* 9. 越权 404（文档 §5.4 / P3 三级权限） */
  console.log('\n--- 9. 越权用例返回 404（避免存在性泄露） ---');
  r = await authGet('/api/uploads/' + objectKey, tokenA);
  check(r.status === 200 && r.body && r.body.data && r.body.data.objectKey === objectKey,
    'owner 本人可读上传元数据 (200)', 'status=' + r.status);

  r = await authGet('/api/uploads/' + objectKey, tokenB);
  check(statusMatches(r.status, 404), '非 owner（账号 B）读取返回 404 而非 403',
    'status=' + r.status);
  check(r.body && r.body.code === 'NOT_FOUND', '越权响应携带统一错误码 code=NOT_FOUND',
    r.text.slice(0, 160));

  r = await req('/api/uploads/' + objectKey);
  check(statusMatches(r.status, 401), '匿名读取上传元数据返回 401', 'status=' + r.status);

  r = await authGet('/api/uploads/no-such-key.png', tokenA);
  check(statusMatches(r.status, 404), '不存在的 objectKey 返回 404', 'status=' + r.status);

  /* 10. 登出回归 */
  console.log('\n--- 10. 登出与会话失效回归 ---');
  r = await jsonPost('/api/logout', {}, tokenA);
  check(r.status === 200, 'POST /api/logout 回归：200', 'status=' + r.status);
  r = await authGet('/api/me', tokenA);
  check(statusMatches(r.status, 401), '登出后令牌立即失效 (401)', 'status=' + r.status);
  r = await jsonPost('/api/logout', {}, tokenB);
  check(r.status === 200, '账号 B 登出成功 (200)', 'status=' + r.status);

  /* 11. 精确清理（含 upload 表），不触碰存量数据 */
  console.log('\n--- 11. 测试账号精确清理 ---');
  if (createdPhones.length > 0) {
    const inList = createdPhones.map((p) => "'" + p + "'").join(',');
    try {
      try {
        mysqlExec('DELETE FROM blog.upload WHERE owner_id IN '
          + '(SELECT id FROM blog.user WHERE phone IN (' + inList + '));');
      } catch (err) {
        // upload 表尚未迁移时忽略，user 清理照常进行
      }
      mysqlExec('DELETE FROM blog.user WHERE phone IN (' + inList + ');');
      const remain = mysqlExec('SELECT COUNT(*) FROM blog.user WHERE phone IN (' + inList + ');');
      check(remain === '0', '探针测试账号已从 MySQL 精确清理（存量数据未动）', 'remain=' + remain);
    } catch (err) {
      check(false, '探针测试账号清理失败（需手动清理）', String(err.message).split('\n')[0]);
    }
  }
  check(!fs.existsSync(path.join(__dirname, '_p0_reverse_baseline.json')),
    '探针未在 tools/ 下遗留临时文件');

  /* 12. 反向注入 */
  const baselineForReverse = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  runReverseTests(baselineForReverse, actualHashes);

  console.log('\n==================================================');
  console.log('结果: 通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length > 0) {
    failures.forEach((item) => console.log('  - ' + item));
    console.log('结论: P0 地基验收未通过');
    process.exitCode = 1;
  } else {
    console.log('结论: P0 地基验收全部通过（源码基线连续性 + 新增能力端到端可用）');
  }
}

main().catch((err) => {
  console.error('探针执行异常:', err);
  process.exitCode = 1;
});
