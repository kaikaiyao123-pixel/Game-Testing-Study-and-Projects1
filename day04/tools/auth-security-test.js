'use strict';

/**
 * 登录注册安全专项验收（自包含，不依赖 Docker / MySQL / 8081）。
 *
 * 用法: node tools/auth-security-test.js
 *
 * 覆盖四层：
 *  [1] 校验器纯函数正反向断言（长度 8~16、注入特征识别、不误判正常值）
 *  [2] HTTP 端到端：长度边界 7/8/16/17、类型混淆、控制字符、超长口令
 *  [3] SQL 注入 payload 拒绝 + 注入后系统完好 + 密码含 SQL 字符仍安全
 *  [4] 源码级静态断言（两套后端规则对齐、SQL 全参数化），含反向注入测试
 *
 * 服务直接加载 server/app.js（端口 0 = 系统分配），数据目录指向临时目录，
 * 结束自动清理，不污染项目 data/。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-authsec-'));

process.env.BLOG_PORT = '0';
process.env.BLOG_HOST = '127.0.0.1';
process.env.BLOG_DATA_DIR = TMP_DIR;

const V = require('../server/lib/credential-validator');
const { server } = require('../server/app.js');

let BASE = '';
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

/** 断言同步校验函数抛出 400（且仅 400）。 */
function expect400(fn, label) {
  try {
    fn();
    check(false, label, '未抛出校验异常');
  } catch (err) {
    const status = Number(err.status) || 0;
    check(status === 400, label, 'status=' + status + ' message=' + err.message);
  }
}

/** 断言同步校验函数正常返回。 */
function expectOk(fn, label) {
  try {
    fn();
    check(true, label);
  } catch (err) {
    check(false, label, '意外抛出: ' + err.message);
  }
}

function waitListening() {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

async function req(pathname, options) {
  const response = await fetch(BASE + pathname, options);
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

/** 构造 11 位合法手机号：138 + 时间戳后 6 位 + 2 位序号 */
function phoneOf(seq) {
  return '138' + String(Date.now()).slice(-6) + String(seq).padStart(2, '0');
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/**
 * 源码级检测：含 SQL 关键字的行是否存在「字符串字面量 + 变量」拼接。
 * 合法的参数化 SQL 常量续行（"..." + "..."）不会被误判。
 */
function hasSqlStringConcat(source) {
  return source.split(/\r?\n/).some((line) => {
    if (!/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(line)) return false;
    return /["'][^"'\n]*["']\s*\+\s*[A-Za-z_$][A-Za-z0-9_$]*/.test(line);
  });
}

const SQL_PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1--",
  "'; DROP TABLE user; --",
  "' UNION SELECT password_hash FROM user--",
  "admin'--",
  "1' AND SLEEP(5)--",
];

async function main() {
  await waitListening();
  BASE = `http://127.0.0.1:${server.address().port}`;
  console.log('================ 登录注册安全专项验收 ================');
  console.log('服务地址: ' + BASE);
  console.log('临时数据目录: ' + TMP_DIR);
  console.log('');

  let successfulRegistrations = 0;

  // ---------- [1] 校验器纯函数 ----------
  console.log('[1] 校验器纯函数');
  check(V.PASSWORD_MIN === 8 && V.PASSWORD_MAX === 16, '密码长度常量为 8~16');
  check(V.PHONE_LENGTH === 11, '手机号固定 11 位（同处 8~16 区间）');

  SQL_PAYLOADS.forEach((payload, i) => {
    check(V.hasSqlInjectionPattern(payload) === true,
      `注入特征 #${i + 1} 被识别: ${payload.slice(0, 24)}`);
  });
  check(V.hasSqlInjectionPattern('张三 2026') === false, '正常昵称不误判为注入（反向）');
  check(V.hasSqlInjectionPattern('Passw0rd!2026') === false, '正常密码不误判为注入（反向）');

  expect400(() => V.validatePassword('Abc1234'), '密码 7 位被拒绝');
  expectOk(() => V.validatePassword('Abc12345'), '密码 8 位通过（下边界，反向）');
  expectOk(() => V.validatePassword('Abc1234567890xyz'), '密码 16 位通过（上边界，反向）');
  expect400(() => V.validatePassword('Abc1234567890xyzq'), '密码 17 位被拒绝');
  expect400(() => V.validatePassword('Passw0rd\n2026'), '密码含控制字符被拒绝');
  expectOk(() => V.validatePassword("' OR 1=1"), "密码含 SQL 元字符仍允许（不做黑名单，反向）");
  expect400(() => V.validateNickname("admin'--"), '昵称含注入特征被拒绝');
  expect400(() => V.validateNickname('a'.repeat(25)), '昵称超长被拒绝');
  expectOk(() => V.validateNickname('测试博主_2026'), '正常中文/下划线昵称通过（反向）');
  expect400(() => V.normalizePhone("1' OR '1'='1"), '手机号含注入特征被拒绝');

  // ---------- [2] HTTP 端到端：长度 / 类型 / 控制字符 ----------
  console.log('\n[2] HTTP 端到端：长度边界与输入安全');
  const lengthCases = [
    { seq: 1, pwd: 'Abc1234', status: 400, label: '注册密码 7 位被拒绝 (400)' },
    { seq: 2, pwd: 'Abc12345', status: 201, label: '注册密码 8 位成功 (201，下边界)' },
    { seq: 3, pwd: 'Abc1234567890xyz', status: 201, label: '注册密码 16 位成功 (201，上边界)' },
    { seq: 4, pwd: 'Abc1234567890xyzq', status: 400, label: '注册密码 17 位被拒绝 (400)' },
    { seq: 5, pwd: '', status: 400, label: '注册密码为空被拒绝 (400)' },
    { seq: 6, pwd: 'A'.repeat(10000), status: 400, label: '超长密码 10000 字符被拒绝 (400)' },
  ];
  for (const item of lengthCases) {
    const r = await jsonPost('/api/register', {
      phone: phoneOf(item.seq), nickname: '安全验收', password: item.pwd,
    });
    check(r.status === item.status, item.label, 'status=' + r.status);
    if (r.status === 201) successfulRegistrations += 1;
  }

  const typeCases = [
    { seq: 10, body: { phone: phoneOf(10), nickname: '类型', password: 12345678 }, label: '密码为数字类型被拒绝 (400)' },
    { seq: 11, body: { phone: phoneOf(11), nickname: '类型', password: ['a', 'b', 'c'] }, label: '密码为数组被拒绝 (400)' },
    { seq: 12, body: { phone: phoneOf(12), nickname: '类型', password: { a: 1 } }, label: '密码为对象被拒绝 (400)' },
    { seq: 13, body: { phone: {}, nickname: '类型', password: 'Passw0rd!2026' }, label: '手机号为对象被拒绝 (400)' },
    { seq: 14, body: { phone: phoneOf(14), nickname: [], password: 'Passw0rd!2026' }, label: '昵称为数组被拒绝 (400)' },
    { seq: 15, body: { phone: phoneOf(15), nickname: '控制符', password: 'Passw0rd\n2026' }, label: '密码含换行控制字符被拒绝 (400)' },
    { seq: 16, body: { phone: phoneOf(16), nickname: 'abc\u0000def', password: 'Passw0rd!2026' }, label: '昵称含 NUL 被拒绝 (400)' },
  ];
  for (const item of typeCases) {
    const r = await jsonPost('/api/register', item.body);
    check(r.status === 400, item.label, 'status=' + r.status);
  }

  // ---------- [3] SQL 注入与系统完好性 ----------
  console.log('\n[3] SQL 注入 payload 拒绝与系统完好性');
  let seq = 20;
  for (const payload of SQL_PAYLOADS) {
    const asPhone = await jsonPost('/api/register', {
      phone: payload, nickname: '注入', password: 'Passw0rd!2026',
    });
    check(asPhone.status === 400, `注入 payload 作为手机号被拒绝: ${payload.slice(0, 20)}`, 'status=' + asPhone.status);

    const asNickname = await jsonPost('/api/register', {
      phone: phoneOf(seq++), nickname: payload, password: 'Passw0rd!2026',
    });
    check(asNickname.status === 400, `注入 payload 作为昵称被拒绝: ${payload.slice(0, 20)}`, 'status=' + asNickname.status);
  }

  // 密码字段不做 SQL 字符黑名单：含注入串的合法长度密码应可注册、可登录，且系统不受影响
  const sqlPwdPhone = phoneOf(40);
  const sqlPwd = "' OR 1=1";
  let r = await jsonPost('/api/register', {
    phone: sqlPwdPhone, nickname: '注入密码', password: sqlPwd,
  });
  check(r.status === 201, '含 SQL 元字符的合法密码可注册（密码不进 SQL）', 'status=' + r.status);
  if (r.status === 201) successfulRegistrations += 1;
  r = await jsonPost('/api/login', { phone: sqlPwdPhone, password: sqlPwd });
  check(r.status === 200 && !!r.body.token, '该密码可正常登录且系统未被注入', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: sqlPwdPhone, password: 'WrongPass!2026' });
  check(r.status === 401, '该账号错误密码仍被拒绝（未被注入绕过）', 'status=' + r.status);

  // 登录侧同样执行 8~16 校验（注册严、登录松的绕过面已关闭）
  const loginPhone = phoneOf(41);
  const loginPwd = 'Passw0rd!2026';
  r = await jsonPost('/api/register', { phone: loginPhone, nickname: '登录校验', password: loginPwd });
  check(r.status === 201, '登录校验账号注册成功', 'status=' + r.status);
  if (r.status === 201) successfulRegistrations += 1;
  r = await jsonPost('/api/login', { phone: loginPhone, password: 'Abc1234' });
  check(r.status === 400, '登录密码 7 位被拒绝 (400)', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: loginPhone, password: 'A'.repeat(17) });
  check(r.status === 400, '登录密码 17 位被拒绝 (400)', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: "' OR 1=1--", password: loginPwd });
  check(r.status === 400, '登录手机号含注入特征被拒绝 (400)', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: loginPhone, password: "' OR 1=1--" });
  check(r.status === 401, '密码含 SQL 元字符按凭据错误处理 (401，不做黑名单)', 'status=' + r.status);
  r = await jsonPost('/api/login', { phone: loginPhone, password: loginPwd });
  check(r.status === 200 && !!r.body.token, '合法凭据仍可登录（注入未破坏系统）', 'status=' + r.status);
  check(!JSON.stringify(r.body).includes('passwordHash'), '登录响应不泄露密码哈希');

  r = await req('/api/health');
  check(r.status === 200 && r.body.userCount === successfulRegistrations,
    '注入尝试未产生越权写入，用户数与成功注册数一致',
    'userCount=' + (r.body && r.body.userCount) + ' 预期=' + successfulRegistrations);

  // ---------- [4] 源码级静态断言 ----------
  console.log('\n[4] 源码级静态断言（两套后端规则对齐 / SQL 全参数化）');
  const nodeAuth = read('server/api/auth.js');
  const nodeValidator = read('server/lib/credential-validator.js');
  const javaService = read('backend/src/main/java/com/example/blog/service/AuthService.java');
  const javaValidator = read('backend/src/main/java/com/example/blog/security/CredentialValidator.java');
  const javaRepo = read('backend/src/main/java/com/example/blog/repository/UserRepository.java');
  const loginJs = read('web/js/login.js');
  const loginHtml = read('web/login.html');

  check(/validateRegister\(body\)/.test(nodeAuth) && /validateLogin\(body\)/.test(nodeAuth),
    'Node auth.js 已接入集中校验器');
  check(!/8~64|8-64|> 64/.test(nodeAuth), 'Node auth.js 不再含 8~64 旧口径');
  check(/CredentialValidator\.validateRegister/.test(javaService)
    && /CredentialValidator\.validateLogin/.test(javaService),
    'Java AuthService 已接入集中校验器');
  check(!/8~64|8-64|> 64/.test(javaService), 'Java AuthService 不再含 8~64 旧口径');
  check(/PASSWORD_MAX\s*=\s*16/.test(nodeValidator) && /PASSWORD_MAX\s*=\s*16/.test(javaValidator),
    '两套校验器密码上限均为 16');
  check(/hasSqlInjectionPattern/.test(nodeValidator) && /hasSqlInjectionPattern/.test(javaValidator),
    '两套校验器均含显式注入特征检测');
  check(/maxlength="16"/.test(loginHtml) && !/8~64/.test(loginHtml),
    '登录页密码框 maxlength=16 且无 8~64 旧提示');
  check(/8~16/.test(loginJs) && !/8~64/.test(loginJs), '前端校验文案为 8~16');
  check(/JdbcTemplate/.test(javaRepo) && /\?/.test(javaRepo),
    'MySQL 仓储使用 JdbcTemplate 参数化占位符');
  check(!hasSqlStringConcat(javaRepo), 'MySQL 仓储不存在 SQL 字符串拼接');

  // ---------- [5] 反向注入测试（证明静态断言不是空壳） ----------
  console.log('\n[5] 反向注入测试（证明断言有效）');
  const GOOD_SQL = '    jdbc.query("SELECT * FROM `user` WHERE phone = ?", mapper, phone);';
  const BAD_SQL = '    jdbc.query("SELECT * FROM user WHERE phone = " + phone, mapper);';
  check(hasSqlStringConcat(GOOD_SQL) === false, '合法参数化 SQL 不被误判（反向）');
  check(hasSqlStringConcat(BAD_SQL) === true, '拼接式 SQL 被检出（正向）');
  const injectedSql = GOOD_SQL.replace('phone = ?', 'phone = " + phone + "');
  check(injectedSql !== GOOD_SQL && hasSqlStringConcat(injectedSql) === true,
    '把占位符替换为拼接后能被检出（注入已知缺陷）');
  check(V.hasSqlInjectionPattern('测试博主') === false
    && V.hasSqlInjectionPattern("' DROP TABLE user;--") === true,
    '注入特征检测同时覆盖正向与反向样本');

  // ---------- 收尾 ----------
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (err) {
    /* 临时目录清理失败不影响验收结论 */
  }

  console.log('\n==================================================');
  console.log(`结果: 通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    failures.forEach((item) => console.log('  - ' + item));
    console.log('结论: 登录注册安全验收未通过');
    process.exitCode = 1;
  } else {
    console.log('结论: 登录注册安全验收全部通过');
  }
}

main().catch(async (err) => {
  console.error('验收执行异常:', err);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (cleanErr) {
    /* ignore */
  }
  try {
    await new Promise((resolve) => server.close(resolve));
  } catch (closeErr) {
    /* ignore */
  }
  process.exitCode = 1;
});
