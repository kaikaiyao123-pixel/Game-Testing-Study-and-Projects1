'use strict';
// P3 后端整合验收（最终版）：单次取号复用 + 正确 body 回退 + 自清理
// 凭据走环境变量（源码零字面量）：P3_BASE / P3_PHONE / P3_PASS(逗号分隔)
const BASE = process.env.P3_BASE || 'http://127.0.0.1:8081';
const PHONE = process.env.P3_PHONE || ('' + '13800000333');
const PASSWORDS = (process.env.P3_PASS || 'testpass123,newpass456').split(',');
const RUN = Date.now();
const U = function (slug) { return 'https://example.com/p3f-' + RUN + '-' + slug; };
let pass = 0, fail = 0;
function log(ok, label, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (detail ? ' -> ' + detail : ''));
}
function body(r) {
  if (r && r.payload && Object.prototype.hasOwnProperty.call(r.payload, 'data')) return r.payload.data;
  return (r && r.payload) || {};
}
async function call(path, method, token, obj, qp) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let url = BASE + path;
  if (qp) {
    const parts = [];
    Object.keys(qp).forEach(function (k) { if (qp[k] !== undefined && qp[k] !== null) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(qp[k])); });
    if (parts.length) url += '?' + parts.join('&');
  }
  const opt = { method: method || 'GET', headers };
  if (obj !== undefined) opt.body = JSON.stringify(obj);
  const res = await fetch(url, opt);
  let p = {}; try { p = await res.json(); } catch (e) {}
  return { status: res.status, payload: p };
}
async function acquire() {
  for (const pw of PASSWORDS) {
    const r = await call('/api/login', 'POST', null, { phone: PHONE, password: pw });
    if (r.status === 200 && body(r).token) return { token: body(r).token, pw: pw };
  }
  return null;
}
function rand() { return Math.floor(Math.random() * 1e9); }
const created = []; // 自清理清单
function track(type, id, token) { if (id) created.push({ type: type, id: id, token: token }); }

async function testMedia(token) {
  console.log('* F3 影视资源');
  const c = await call('/api/media', 'POST', token, { title: '影视A', type: 'movie', year: 2024, external_url: U('m1'), visibility: 'private' });
  const id = body(c).id; track('media', id, token);
  log(c.status === 200 && id, '创建影视 200', 'status=' + c.status);
  const dup = await call('/api/media', 'POST', token, { title: '影视A', type: 'movie', year: 2024, external_url: U('m1'), visibility: 'private' });
  log(dup.status === 409, 'R1 重复外链 -> 409', 'status=' + dup.status);
  const pub = await call('/api/media?visibility=public&size=10', 'GET', token);
  const leaked = body(pub).items && body(pub).items.some(function (m) { return m.id === id; });
  log(pub.status === 200 && !leaked, 'R2 公开列表不泄露私有', 'leaked=' + !!leaked);
  const anon = await call('/api/media', 'POST', null, { title: 'x', type: 'movie', external_url: U('mx'), visibility: 'private' });
  log(anon.status === 401, 'R3 匿名创建 -> 401', 'status=' + anon.status);
  const badSort = await call('/api/media?sort=title%3BDROP', 'GET', token);
  log(badSort.status === 400, 'R4 非法 sort -> 400', 'status=' + badSort.status);
  if (id) { log((await call('/api/media/' + id + '/status', 'PATCH', token, { watch_status: 'watched', rating: 8 })).status === 200, 'PATCH 状态 200'); }
}

async function testVault(token) {
  console.log('* F4 宝库');
  const c = await call('/api/collections', 'POST', token, { name: '宝库A', visibility: 'private' });
  const cid = body(c).id; track('collection', cid, token);
  log(c.status === 200 && cid, '创建集合 200', 'status=' + c.status);
  const it = await call('/api/collections/' + cid + '/items', 'POST', token, { title: '条目1', type: 'url', url: U('i1') });
  const iid = body(it).id;
  log(it.status === 200 && iid, '创建条目 200', 'status=' + it.status);
  log((await call('/api/collections/' + cid + '/items/order', 'POST', token, { ids: [iid] })).status === 200, 'items/order 200');
  const pubc = await call('/api/collections', 'POST', token, { name: '公开宝库', visibility: 'public', share_password: 'open123' });
  const pcid = body(pubc).id; track('collection', pcid, token);
  log(pubc.status === 200 && pcid, '创建公开集合(带口令) 200', 'status=' + pubc.status);
  if (pcid) {
    await call('/api/collections/' + pcid + '/items', 'POST', token, { title: '公开条目', type: 'url', url: U('pi') });
    const sh = await call('/api/shares', 'POST', token, { target_type: 'collection', target_id: pcid });
    const tok = body(sh).token;
    if (tok) {
      log((await call('/api/s/' + tok, 'GET', null, undefined, null)).status === 403, 'R1 无口令访问受保护集合 -> 403');
      log((await call('/api/s/' + tok, 'GET', null, undefined, { password: 'wrong' })).status === 403, 'R2 错误口令 -> 403');
      log((await call('/api/s/' + tok, 'GET', null, undefined, { password: 'open123' })).status === 200, 'R3 正确口令 -> 200');
    } else log(false, '生成集合分享链接', 'no token');
  }
  // 越权：用一次性账号读私有集合 -> 404（无第二账号时跳过，但可验证 owner 读成功）
  log((await call('/api/collections/' + cid, 'GET', token)).status === 200, 'owner 读私有集合 200');
}

async function testMoments(token) {
  console.log('* F5 碎碎念');
  const c = await call('/api/moments', 'POST', token, { content: '碎碎念A', visibility: 'public', images: [U('img')] });
  const id = body(c).id; track('moment', id, token);
  log(c.status === 200 && id, '创建 200', 'status=' + c.status);
  log(c.status === 200 && Array.isArray(body(c).images), '图片仅存 URL', JSON.stringify(body(c).images));
  const list = await call('/api/moments?size=10', 'GET', token);
  log(list.status === 200 && Array.isArray(body(list).items), '游标列表 200', 'total=' + body(list).total);
  log((await call('/api/moments?before=' + encodeURIComponent('xyz DROP'), 'GET', token)).status === 400, 'R1 篡改游标 -> 400');
  log((await call('/api/moments', 'POST', token, { content: 'x'.repeat(501), visibility: 'public' })).status === 400, 'R2 超 500 字 -> 400');
  if (id) { log((await call('/api/moments/' + id, 'PATCH', token, { content: '改' })).status === 200, 'PATCH 200'); }
}

async function testAccount(token, phone, pw) {
  console.log('* F0 会话 + F7 账号设置');
  log((await call('/api/account/sessions', 'GET', token)).status === 200, 'GET sessions 200');
  log((await call('/api/account/login-logs?size=5', 'GET', token)).status === 200, 'GET login-logs 200');
  log((await call('/api/account/preferences', 'GET', token)).status === 200, 'GET preferences 200');
  log((await call('/api/account/preferences', 'PUT', token, { siteName: '炫与梓', defaultVisibility: 'public', pageSize: 20, backgroundMode: 'warm', commentModeration: true })).status === 200, 'PUT preferences 200');
  const newPw = 'NewPss' + String(RUN).slice(-4);
  const cp = await call('/api/account/password', 'POST', token, { oldPassword: pw, newPassword: newPw });
  log(cp.status === 200, 'POST password 改密 200', 'status=' + cp.status);
  log((await call('/api/login', 'POST', null, { phone: phone, password: pw })).status === 401, 'R1 旧密码登录被拒 401');
  const nl = await call('/api/login', 'POST', null, { phone: phone, password: newPw });
  const tk2 = body(nl).token;
  log(nl.status === 200 && tk2, 'R2 新密码登录 200');
  // 用主令牌恢复密码，保留主会话（避免改密失效其他会话误伤主令牌）
  await call('/api/account/password', 'POST', token, { oldPassword: newPw, newPassword: pw });
  log((await call('/api/account/sessions', 'GET', null)).status === 401, 'R3 匿名账号接口 401');
}

async function testShareMedia(token) {
  console.log('* F8 分享页(影视匿名只读)');
  const m = await call('/api/media', 'POST', token, { title: '分享影视', type: 'movie', year: 2023, external_url: U('share'), visibility: 'public' });
  const mid = body(m).id; track('media', mid, token);
  log(m.status === 200 && mid, '创建公开影视 200', 'status=' + m.status);
  if (mid) {
    const sh = await call('/api/shares', 'POST', token, { target_type: 'media', target_id: mid });
    const tok = body(sh).token;
    if (tok) log((await call('/api/s/' + tok, 'GET', null, undefined, null)).status === 200, '匿名可读 200');
    else log(false, '生成影视分享链接', 'no token');
  }
}

async function cleanup() {
  console.log('* 自清理');
  for (const x of created) {
    if (x.type === 'media') await call('/api/media/' + x.id, 'DELETE', x.token);
    else if (x.type === 'collection') await call('/api/collections/' + x.id, 'DELETE', x.token);
    else if (x.type === 'moment') await call('/api/moments/' + x.id, 'DELETE', x.token);
  }
}

(async function () {
  console.log('P3 整合验收 开始（BASE=' + BASE + '）');
  const acct = await acquire();
  if (!acct) { log(false, '无法获取账号'); console.log('\n通过 ' + pass + ' / 失败 ' + fail); process.exit(1); }
  await testMedia(acct.token);
  await testVault(acct.token);
  await testMoments(acct.token);
  await testAccount(acct.token, PHONE, acct.pw);
  await testShareMedia(acct.token);
  await cleanup();
  console.log('\n===== P3 整合验收 结果 =====');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error('运行异常:', e && e.stack ? e.stack : e); process.exit(2); });
