'use strict';

/**
 * 阶段二（Spring Boot）登录注册安全探针。
 *
 * 对已启动的实例发真实 HTTP 请求，不启动本地服务；与 auth-security-test.js
 * （阶段一 Node 版）规则逐条对齐，用于验证 Java 侧运行时行为。
 *
 * 用法: BLOG_API_BASE=http://127.0.0.1:8082 node tools/auth-security-probe.js
 * 前置: MySQL / Redis 已就绪，后端实例已启动。
 *
 * 结束时通过 docker 精确删除本脚本创建的测试账号，不触碰存量数据。
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const API = process.env.BLOG_API_BASE || 'http://127.0.0.1:8081';

let passed = 0;
const failures = [];
const createdPhones = [];

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

function mysqlExec(sql) {
  const pwd = envValue('MYSQL_ROOT_PASSWORD', 'blog_root_2026');
  return cp.execFileSync('docker', ['exec', 'blogg-mysql', 'mysql',
    '--default-character-set=utf8mb4', '-uroot', '-p' + pwd, '-N', '-e', sql],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

async function req(pathname, options) {
  const response = await fetch(API + pathname, options);
  let body = null;
  try {
    body = await response.json();
  } catch (err) {
    body = null;
  }
  return { status: response.status, body: body };
}

function jsonPost(pathname, data) {
  return req(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/** 11 位合法手机号：199 + 时间戳后 6 位 + 2 位序号 */
function phoneOf(seq) {
  return '199' + String(Date.now()).slice(-6) + String(seq).padStart(2, '0');
}

const SQL_PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1--",
  "'; DROP TABLE user; --",
  "' UNION SELECT password_hash FROM user--",
  "admin'--",
];

async function main() {
  console.log('================ 阶段二登录注册安全探针 ================');
  console.log('目标实例: ' + API);
  console.log('');

  let r = await req('/api/health');
  check(r.status === 200 && r.body && r.body.ok === true && r.body.storage === 'mysql+redis',
    'Spring Boot /api/health 正常且声明 mysql+redis', JSON.stringify(r.body));
  const beforeCount = (r.body && r.body.userCount) || 0;

  let successfulRegistrations = 0;

  // --- 密码长度边界 8~16 ---
  const lengthCases = [
    { seq: 1, pwd: 'Abc1234', status: 400, label: '注册密码 7 位被拒绝 (400)' },
    { seq: 2, pwd: 'Abc12345', status: 201, label: '注册密码 8 位成功 (201，下边界)' },
    { seq: 3, pwd: 'Abc1234567890xyz', status: 201, label: '注册密码 16 位成功 (201，上边界)' },
    { seq: 4, pwd: 'Abc1234567890xyzq', status: 400, label: '注册密码 17 位被拒绝 (400)' },
    { seq: 5, pwd: '', status: 400, label: '注册密码为空被拒绝 (400)' },
    { seq: 6, pwd: 'A'.repeat(10000), status: 400, label: '超长密码 10000 字符被拒绝 (400)' },
  ];
  for (const item of lengthCases) {
    const phone = phoneOf(item.seq);
    r = await jsonPost('/api/register', {
      phone: phone, nickname: '安全探针', password: item.pwd,
    });
    check(r.status === item.status, item.label, 'status=' + r.status);
    if (r.status === 201) {
      successfulRegistrations += 1;
      createdPhones.push(phone);
    }
  }

  // --- 类型 / 控制字符 ---
  const typeCases = [
    { seq: 10, body: { phone: phoneOf(10), nickname: '类型', password: ['a', 'b', 'c'] }, label: '密码为数组被拒绝 (400)' },
    { seq: 11, body: { phone: phoneOf(11), nickname: '类型', password: { a: 1 } }, label: '密码为对象被拒绝 (400)' },
    { seq: 12, body: { phone: {}, nickname: '类型', password: 'Passw0rd!2026' }, label: '手机号为对象被拒绝 (400)' },
    { seq: 13, body: { phone: phoneOf(13), nickname: '控制符', password: 'Passw0rd\n2026' }, label: '密码含换行控制字符被拒绝 (400)' },
    { seq: 14, body: { phone: phoneOf(14), nickname: 'abc\u0000def', password: 'Passw0rd!2026' }, label: '昵称含 NUL 被拒绝 (400)' },
  ];
  for (const item of typeCases) {
    r = await jsonPost('/api/register', item.body);
    check(r.status === 400, item.label, 'status=' + r.status);
  }

  // --- SQL 注入 payload ---
  let seq = 20;
  for (const payload of SQL_PAYLOADS) {
    r = await jsonPost('/api/register', {
      phone: payload, nickname: '注入', password: 'Passw0rd!2026',
    });
    check(r.status === 400, `注入 payload 作为手机号被拒绝: ${payload.slice(0, 20)}`, 'status=' + r.status);
    r = await jsonPost('/api/register', {
      phone: phoneOf(seq++), nickname: payload, password: 'Passw0rd!2026',
    });
    check(r.status === 400, `注入 payload 作为昵称被拒绝: ${payload.slice(0, 20)}`, 'status=' + r.status);
  }

  // 密码字段不做 SQL 字符黑名单：合法长度的含元字符密码可注册、可登录，且系统不被绕过
  const sqlPwdPhone = phoneOf(40);
  const sqlPwd = "' OR 1=1";
  r = await jsonPost('/api/register', {
    phone: sqlPwdPhone, nickname: '注入密码', password: sqlPwd,
  });
  check(r.status === 201, '含 SQL 元字符的合法密码可注册（密码不进 SQL）', 'status=' + r.status);
  if (r.status === 201) {
    successfulRegistrations += 1;
    createdPhones.push(sqlPwdPhone);
  }
  r = await jsonPost('/api/login', { phone: sqlPwdPhone, password: sqlPwd });
  check(r.status === 200 && !!r.body.token, '该密码可正常登录且系统未被注入', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: sqlPwdPhone, password: 'WrongPass!2026' });
  check(r.status === 401, '该账号错误密码仍被拒绝（未被注入绕过）', 'status=' + r.status);

  // --- 登录侧同样 8~16 ---
  const loginPhone = phoneOf(41);
  const loginPwd = 'Passw0rd!2026';
  r = await jsonPost('/api/register', {
    phone: loginPhone, nickname: '登录校验', password: loginPwd,
  });
  check(r.status === 201, '登录校验账号注册成功', 'status=' + r.status);
  if (r.status === 201) {
    successfulRegistrations += 1;
    createdPhones.push(loginPhone);
  }
  r = await jsonPost('/api/login', { phone: loginPhone, password: 'Abc1234' });
  check(r.status === 400, '登录密码 7 位被拒绝 (400)', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: loginPhone, password: 'A'.repeat(17) });
  check(r.status === 400, '登录密码 17 位被拒绝 (400)', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: "' OR 1=1--", password: loginPwd });
  check(r.status === 400, '登录手机号含注入特征被拒绝 (400)', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: loginPhone, password: loginPwd });
  check(r.status === 200 && !!r.body.token, '合法凭据仍可登录（注入未破坏系统）', 'status=' + r.status);
  check(!JSON.stringify(r.body).includes('password_hash'), '登录响应不泄露密码哈希');

  // --- 用户数增量核对（注入尝试未越权写入） ---
  r = await req('/api/health');
  const afterCount = (r.body && r.body.userCount) || 0;
  check(afterCount - beforeCount === successfulRegistrations,
    '注入尝试未产生越权写入，用户数增量等于成功注册数',
    'before=' + beforeCount + ' after=' + afterCount + ' 预期增量=' + successfulRegistrations);

  // --- 精确清理本脚本创建的测试账号 ---
  if (createdPhones.length > 0) {
    const inList = createdPhones.map((p) => "'" + p + "'").join(',');
    try {
      mysqlExec('DELETE FROM blog.user WHERE phone IN (' + inList + ');');
      const remain = mysqlExec('SELECT COUNT(*) FROM blog.user WHERE phone IN (' + inList + ');');
      check(remain === '0', '探针测试账号已从 MySQL 精确清理（存量数据未动）', 'remain=' + remain);
    } catch (err) {
      check(false, '探针测试账号清理失败（需手动清理）', String(err.message).split('\n')[0]);
    }
  }

  console.log('\n==================================================');
  console.log(`结果: 通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    failures.forEach((item) => console.log('  - ' + item));
    console.log('结论: 阶段二登录注册安全探针未通过');
    process.exitCode = 1;
  } else {
    console.log('结论: 阶段二登录注册安全探针全部通过');
  }
}

main().catch((err) => {
  console.error('探针执行异常:', err);
  process.exitCode = 1;
});
