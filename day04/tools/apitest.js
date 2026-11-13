'use strict';

/**
 * 真实 HTTP 端到端测试。
 * 直接加载 server/app.js（端口 0 = 系统分配），数据目录指向临时目录，
 * 不污染项目 data/。覆盖注册、入库、登录、鉴权、登出、静态资源与安全防护。
 *
 * 用法: node tools/apitest.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-apitest-'));

process.env.BLOG_PORT = '0';
process.env.BLOG_HOST = '127.0.0.1';
process.env.BLOG_DATA_DIR = TMP_DIR;

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
  return { status: response.status, body: body, headers: response.headers };
}

function jsonPost(pathname, data, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return req(pathname, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(data),
  });
}

function authGet(pathname, token) {
  return req(pathname, { headers: { Authorization: 'Bearer ' + token } });
}

/** 用原始 http.request 发送未规范化路径，验证目录穿越防护 */
function rawGet(rawPath, port) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: port, path: rawPath, method: 'GET' },
      (response) => {
        let text = '';
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, text: text }));
      }
    );
    request.on('error', reject);
    request.end();
  });
}

async function main() {
  await waitListening();
  const port = server.address().port;
  BASE = `http://127.0.0.1:${port}`;
  const phone = '138' + String(Date.now()).slice(-8);
  const password = 'Passw0rd!2026';

  console.log('================ 端到端 API 测试 ================');
  console.log('服务地址: ' + BASE);
  console.log('临时数据目录: ' + TMP_DIR);
  console.log('');

  // --- 健康检查 ---
  let r = await req('/api/health');
  check(
    r.status === 200 && r.body && r.body.ok === true && r.body.userCount === 0,
    '健康检查返回 200，初始用户数为 0',
    JSON.stringify(r.body)
  );

  // --- 注册参数校验 ---
  r = await jsonPost('/api/register', { phone: '12345', nickname: '测试', password: password });
  check(r.status === 400, '非法手机号注册被拒绝 (400)');

  r = await jsonPost('/api/register', { phone: phone, nickname: '测试', password: '123' });
  check(r.status === 400, '密码过短注册被拒绝 (400)');

  r = await jsonPost('/api/register', { phone: phone, nickname: '', password: password });
  check(r.status === 400, '空昵称注册被拒绝 (400)');

  // --- 正常注册 ---
  r = await jsonPost('/api/register', { phone: phone, nickname: '测试博主', password: password });
  check(r.status === 201 && r.body && r.body.ok === true, '手机号注册成功 (201)', JSON.stringify(r.body));
  check(r.body && r.body.user && r.body.user.phone === phone, '注册响应返回正确手机号');
  check(!JSON.stringify(r.body).includes('passwordHash'), '注册响应不泄露密码哈希');
  check(!JSON.stringify(r.body).includes(password), '注册响应不泄露明文密码');

  // --- 入库验证 ---
  const usersFile = path.join(TMP_DIR, 'users.json');
  const usersRaw = fs.readFileSync(usersFile, 'utf8');
  const usersDoc = JSON.parse(usersRaw);
  const saved = usersDoc.users.find((item) => item.phone === phone);
  check(!!saved, '用户已写入 users.json（真实入库）');
  check(
    !!saved && /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(saved.passwordHash),
    '密码以 scrypt 加盐哈希存储',
    saved && saved.passwordHash
  );
  check(!usersRaw.includes(password), 'users.json 不含明文密码');
  check(!!saved && saved.nickname === '测试博主', '昵称正确入库');

  // --- 唯一性约束 ---
  r = await jsonPost('/api/register', { phone: phone, nickname: '再来一次', password: password });
  check(r.status === 409, '重复手机号注册被拒绝 (409)');

  // --- 登录校验 ---
  r = await jsonPost('/api/login', { phone: phone, password: 'WrongPass!2026' });
  check(r.status === 401, '错误密码登录被拒绝 (401)');

  r = await jsonPost('/api/login', { phone: '13900000000', password: password });
  check(r.status === 401, '不存在的账号登录被拒绝 (401)');

  r = await jsonPost('/api/login', { phone: phone, password: password });
  check(
    r.status === 200 && r.body && typeof r.body.token === 'string' && r.body.token.length >= 32,
    '正确凭据登录成功并签发令牌',
    JSON.stringify(r.body)
  );
  const token = r.body && r.body.token;
  check(!!r.body.user && r.body.user.phone === phone, '登录响应返回当前用户');
  check(!!r.body.user && !!r.body.user.lastLoginAt, '登录成功后写入 lastLoginAt');

  const sessionsFile = path.join(TMP_DIR, 'sessions.json');
  const sessionsDoc = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  check(sessionsDoc.sessions.some((item) => item.token === token), '会话已写入 sessions.json');

  // --- 鉴权 ---
  r = await req('/api/me');
  check(r.status === 401, '无令牌访问 /api/me 被拒绝 (401)');

  r = await authGet('/api/me', 'forged-token-xxxxxxxx');
  check(r.status === 401, '伪造令牌访问 /api/me 被拒绝 (401)');

  r = await authGet('/api/me', token);
  check(
    r.status === 200 && r.body.user.phone === phone,
    '有效令牌返回当前用户与会话信息',
    JSON.stringify(r.body)
  );

  // --- 静态资源 ---
  let response = await fetch(BASE + '/login.html');
  let text = await response.text();
  check(
    response.status === 200 && (response.headers.get('content-type') || '').includes('text/html'),
    '登录页静态资源可访问'
  );
  check(text.includes('id="form-login"'), '登录页包含登录表单');

  response = await fetch(BASE + '/home.html');
  check(response.status === 200, '主页静态资源可访问');

  response = await fetch(BASE + '/');
  check(response.status === 200, '根路径返回登录页');

  response = await fetch(BASE + '/js/api.js');
  check(response.status === 200, '前端 JS 资源可访问');

  // --- 安全防护 ---
  const traversal = await rawGet('/%2e%2e%2fdata%2fusers.json', port);
  check(traversal.status === 403, '目录穿越读取 data/ 被拦截 (403)', 'status=' + traversal.status);

  r = await req('/api/not-exist');
  check(r.status === 404, '未知接口返回 404');

  r = await req('/api/login', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://example.com',
      'Access-Control-Request-Method': 'POST',
    },
  });
  check(
    r.status === 204 && r.headers.get('access-control-allow-origin') === '*',
    'CORS 预检正确响应',
    'status=' + r.status
  );

  // --- 登出（真登出） ---
  r = await jsonPost('/api/logout', {}, token);
  check(r.status === 200, '登出接口返回 200');

  r = await authGet('/api/me', token);
  check(r.status === 401, '登出后令牌立即失效 (401)');

  const sessionsAfter = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  check(
    !sessionsAfter.sessions.some((item) => item.token === token),
    '会话已从 sessions.json 删除'
  );

  // --- 重新登录 ---
  r = await jsonPost('/api/login', { phone: phone, password: password });
  check(
    r.status === 200 && !!r.body.token && r.body.token !== token,
    '重新登录签发全新令牌'
  );

  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (err) {
    /* 临时目录清理失败不影响测试结论 */
  }

  console.log('\n==================================================');
  console.log(`结果: 通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length > 0) {
    failures.forEach((item) => console.log('  - ' + item));
    console.log('结论: 端到端测试未通过');
    process.exitCode = 1;
  } else {
    console.log('结论: 端到端测试全部通过');
  }
}

main().catch(async (err) => {
  console.error('测试执行异常:', err);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (cleanErr) {
    /* ignore */
  }
  process.exitCode = 1;
});
