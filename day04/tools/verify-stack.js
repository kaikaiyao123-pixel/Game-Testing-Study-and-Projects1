'use strict';

/**
 * 阶段二全栈验收（Spring Boot + MySQL + Redis + 独立静态前端）。
 *
 * 逐层断言：容器健康 → 库表结构/索引 → API 全链路 → Redis 会话键与 TTL
 * → 登出失效 → CORS → 前端页面 → 测试账号备份后清理。
 *
 * 用法: node tools/verify-stack.js
 * 前置：docker compose up -d --wait mysql redis；后端 8081；前端 3000 均已启动。
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://127.0.0.1:8081';
const WEB = 'http://127.0.0.1:3000';
const BACKUP = path.join(ROOT, 'tools', '_verify_backup.sql');

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
}

function envValue(key, fallback) {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return fallback;
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .find((item) => item.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim() : fallback;
}

function sh(cmd, args) {
  try {
    return cp.execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString().trim();
  } catch (err) {
    return '__ERROR__ ' + String(err.stderr || err.message).trim().split('\n')[0];
  }
}

function mysqlQuery(sql) {
  const pwd = envValue('MYSQL_ROOT_PASSWORD', 'blog_root_2026');
  return sh('docker', ['exec', 'blogg-mysql', 'mysql', '--default-character-set=utf8mb4',
    '-uroot', '-p' + pwd, '-N', '-e', sql]);
}

function redisCmd(args) {
  return sh('docker', ['exec', 'blogg-redis', 'redis-cli'].concat(args));
}

async function req(pathname, options) {
  const response = await fetch(API + pathname, options);
  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }
  return { status: response.status, body: body, headers: response.headers };
}

function jsonPost(pathname, data, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return req(pathname, { method: 'POST', headers: headers, body: JSON.stringify(data) });
}

function authGet(pathname, token) {
  return req(pathname, { headers: { Authorization: 'Bearer ' + token } });
}

async function main() {
  const phone = '199' + String(Date.now()).slice(-8);
  const password = 'Verify@2026Xyz';
  console.log('================ 全栈验收 (SpringBoot/MySQL/Redis) ================');
  console.log('后端 ' + API + ' | 前端 ' + WEB + ' | 测试手机号 ' + phone);
  console.log('');

  // --- 1. 容器健康 ---
  const mysqlHealth = sh('docker', ['inspect', '--format', '{{.State.Health.Status}}', 'blogg-mysql']);
  const redisHealth = sh('docker', ['inspect', '--format', '{{.State.Health.Status}}', 'blogg-redis']);
  check(mysqlHealth === 'healthy', 'MySQL 容器 healthy', mysqlHealth);
  check(redisHealth === 'healthy', 'Redis 容器 healthy', redisHealth);

  // --- 2. 库表结构与索引 ---
  const tableCount = mysqlQuery(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='blog' AND table_name='user';");
  check(tableCount === '1', 'MySQL blog.user 表已由 init.sql 创建', tableCount);

  const columns = mysqlQuery(
    "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema='blog' AND table_name='user';");
  check(['id', 'phone', 'nickname', 'password_hash', 'created_at_ms', 'last_login_at_ms', 'login_fails', 'locked_until_ms']
    .every((col) => columns.split(/\r?\n/).map((s) => s.trim()).includes(col)), 'user 表字段与设计一致', columns.replace(/\r?\n/g, ','));

  const uniqueIndex = mysqlQuery(
    "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema='blog' AND table_name='user' AND index_name='uk_user_phone';");
  check(Number(uniqueIndex) > 0, '手机号唯一索引 uk_user_phone 存在', uniqueIndex);

  // --- 3. API 健康检查 ---
  let r = await req('/api/health');
  check(r.status === 200 && r.body && r.body.ok === true && r.body.storage === 'mysql+redis',
    'Spring Boot /api/health 正常且声明 mysql+redis', JSON.stringify(r.body));

  // --- 4. 注册参数校验 ---
  r = await jsonPost('/api/register', { phone: '12345', nickname: '验收', password: password });
  check(r.status === 400, '非法手机号注册被拒绝 (400)');

  r = await jsonPost('/api/register', { phone: phone, nickname: '验收', password: '123' });
  check(r.status === 400, '密码过短被拒绝 (400)');

  // --- 5. 正常注册并核对 MySQL ---
  r = await jsonPost('/api/register', { phone: phone, nickname: '验收账号', password: password });
  check(r.status === 201 && r.body && r.body.ok === true, '手机号注册成功 (201)', JSON.stringify(r.body));
  check(!!r.body.user && r.body.user.phone === phone, '注册响应返回正确手机号');
  check(!JSON.stringify(r.body).includes('password_hash'), '注册响应不泄露密码哈希');
  check(!JSON.stringify(r.body).includes(password), '注册响应不泄露明文密码');

  const rowCount = mysqlQuery("SELECT COUNT(*) FROM blog.user WHERE phone='" + phone + "';");
  check(rowCount === '1', '用户已真实写入 MySQL', rowCount);

  const hash = mysqlQuery("SELECT password_hash FROM blog.user WHERE phone='" + phone + "';");
  check(/^pbkdf2\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(hash),
    '密码以 PBKDF2 加盐哈希存储', hash.slice(0, 60));

  const plainCount = mysqlQuery(
    "SELECT COUNT(*) FROM blog.user WHERE password_hash LIKE '%" + password + "%';");
  check(plainCount === '0', 'MySQL 中不含明文密码', plainCount);

  // --- 6. 唯一性约束 ---
  r = await jsonPost('/api/register', { phone: phone, nickname: '重复', password: password });
  check(r.status === 409, '重复手机号被唯一索引拒绝 (409)');

  // --- 7. 登录 ---
  r = await jsonPost('/api/login', { phone: phone, password: 'WrongPass@2026' });
  check(r.status === 401, '错误密码登录被拒绝 (401)');

  r = await jsonPost('/api/login', { phone: '19900000000', password: password });
  check(r.status === 401, '不存在账号登录被拒绝 (401)');

  r = await jsonPost('/api/login', { phone: phone, password: password });
  check(r.status === 200 && !!r.body.token && r.body.token.length >= 32,
    '正确凭据登录成功并签发令牌', JSON.stringify(r.body));
  const token = r.body && r.body.token;
  check(!!r.body.user && !!r.body.user.lastLoginAt, '登录后写入 lastLoginAt');

  // --- 8. Redis 会话 ---
  const keys = redisCmd(['KEYS', 'blog:session:*']);
  check(keys.includes('blog:session:' + token), 'Redis 中存在该会话键', keys.slice(0, 120));
  const ttl = redisCmd(['TTL', 'blog:session:' + token]);
  check(Number(ttl) > 0, '会话键 TTL > 0（Redis 自动过期生效）', 'ttl=' + ttl);

  // --- 9. 鉴权 ---
  r = await req('/api/me');
  check(r.status === 401, '无令牌访问 /api/me 被拒绝 (401)');

  r = await authGet('/api/me', 'forged-token-xxxxxxxx');
  check(r.status === 401, '伪造令牌访问 /api/me 被拒绝 (401)');

  r = await authGet('/api/me', token);
  check(r.status === 200 && r.body.user.phone === phone,
    '有效令牌返回当前用户与会话信息', JSON.stringify(r.body));

  // --- 10. 未知接口与 CORS ---
  r = await req('/api/not-exist');
  check(r.status === 404 && r.body && r.body.ok === false, '未知接口返回 JSON 404', JSON.stringify(r.body));

  r = await req('/api/login', {
    method: 'OPTIONS',
    headers: { Origin: WEB, 'Access-Control-Request-Method': 'POST' },
  });
  const allowOrigin = r.headers.get('access-control-allow-origin');
  check((r.status === 200 || r.status === 204) && !!allowOrigin,
    'CORS 预检放行前端 3000', 'status=' + r.status + ' allow-origin=' + allowOrigin);

  // --- 11. 登出（真登出） ---
  r = await jsonPost('/api/logout', {}, token);
  check(r.status === 200, '登出接口返回 200');

  const keysAfter = redisCmd(['KEYS', 'blog:session:*']);
  check(!keysAfter.includes('blog:session:' + token), '登出后 Redis 会话键被删除');

  r = await authGet('/api/me', token);
  check(r.status === 401, '登出后令牌立即失效 (401)');

  // --- 12. 前端静态服务 ---
  const configText = fs.readFileSync(path.join(ROOT, 'web/js/config.js'), 'utf8');
  check(/API_BASE:\s*'http:\/\/127\.0\.0\.1:8081'/.test(configText),
    '前端 API_BASE 已指向 Spring Boot 8081');

  try {
    const page = await fetch(WEB + '/login.html');
    const html = await page.text();
    check(page.status === 200 && html.includes('id="form-login"'), '前端登录页可访问且含表单');
    const js = await fetch(WEB + '/js/api.js');
    check(js.status === 200, '前端 JS 资源可访问');
  } catch (err) {
    check(false, '前端静态服务可访问', err.message);
  }

  // --- 13. 测试账号备份后清理 ---
  const backup = mysqlQuery(
    "SELECT id,phone,nickname,password_hash,created_at_ms,last_login_at_ms,login_fails,locked_until_ms "
    + "FROM blog.user WHERE phone='" + phone + "';");
  fs.writeFileSync(BACKUP,
    '-- 验收测试账号备份（删除前导出，可据此回滚）\n' + backup + '\n', 'utf8');
  check(!backup.startsWith('__ERROR__'), '清理前已导出测试账号备份');

  mysqlQuery("DELETE FROM blog.user WHERE phone='" + phone + "';");
  const remain = mysqlQuery("SELECT COUNT(*) FROM blog.user WHERE phone='" + phone + "';");
  check(remain === '0', '测试账号已从 MySQL 清理', remain);

  const finalHealth = await req('/api/health');
  check(finalHealth.status === 200 && finalHealth.body.userCount === 0,
    '清理后用户表回到初始状态', JSON.stringify(finalHealth.body));

  console.log('\n==============================================================');
  console.log('结果: 通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length > 0) {
    failures.forEach((item) => console.log('  - ' + item));
    console.log('结论: 全栈验收未通过');
    process.exitCode = 1;
  } else {
    console.log('备份文件: ' + BACKUP + '（测试账号删除前的导出，可自行删除）');
    console.log('结论: 全栈验收全部通过');
  }
}

main().catch((err) => {
  console.error('验收执行异常:', err);
  process.exitCode = 1;
});
