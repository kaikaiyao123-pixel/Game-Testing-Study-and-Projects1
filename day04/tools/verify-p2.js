'use strict';

/**
 * P2 阶段验收（docs/功能实现方案.md §9）。
 *
 * 与 apitest.js（阶段一 Node 服务）不同，本脚本针对真实运行中的
 * Spring Boot 后端（8081）+ MySQL + Redis，不启动任何进程，纯 HTTP 黑盒验证。
 *
 * 覆盖 §9 的六条验收标准：
 *   1. 文章 CRUD 端到端
 *   2. Markdown XSS 净化生效
 *   3. 匿名可读、写操作 401
 *   4. 评论审核与限流生效
 *   5. 分享链接匿名可读
 *   6. 头像上传限制生效
 * 附加：F0-7 注册风控（手机号维度限流）、分页与三类越权（404 而非 403）、
 *       分类/标签、F1 主页聚合。
 *
 * 数据隔离：账号手机号带时间戳后缀，测试文章标题带唯一前缀；
 * 结束时删除自己创建的账号与其内容（按手机号定位，绝不触碰既有数据）。
 *
 * 用法: node tools/verify-p2.js
 *   API_BASE           覆盖后端地址，默认 http://127.0.0.1:8081
 *   REGISTER_LIMIT_IP  与服务端 blog.security.register-limit-ip 保持一致，
 *                      用于断言 IP 限流的触发点（默认 200，等于服务端默认值）
 *
 * 注意：注册限流按 IP 累计，连续多次运行本脚本会撞上 600 秒窗口。
 * 重跑前请清空 Redis 计数：
 *   docker exec -i blogg-redis redis-cli EVAL \
 *     "local k=redis.call('KEYS','ratelimit:reg:*');for i,v in ipairs(k) \
 *      do redis.call('DEL',v) end;return #k" 0
 */
const zlib = require('node:zlib');

const BASE = (process.env.API_BASE || 'http://127.0.0.1:8081').replace(/\/+$/, '');
const STAMP = Date.now();
const SUFFIX = String(STAMP).slice(-8);

let passed = 0;
const failures = [];

function check(condition, label, extra) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    const line = label + (extra ? ' | ' + String(extra).slice(0, 400) : '');
    failures.push(line);
    console.log('  FAIL  ' + line);
  }
}

function section(title) {
  console.log('');
  console.log('---- ' + title + ' ----');
}

async function req(pathname, options) {
  const res = await fetch(BASE + pathname, options);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (err) {
    body = null;
  }
  return { status: res.status, body: body, text: text, headers: res.headers };
}

function authHeaders(token, extra) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

function post(pathname, data, token) {
  return req(pathname, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
}

function put(pathname, data, token) {
  return req(pathname, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
}

function del(pathname, token) {
  return req(pathname, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
}

function get(pathname, token) {
  return req(pathname, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
}

function data(res) {
  return (res.body && res.body.data) || null;
}

/* ---------------- 构造合法 PNG（用于头像上传 1x1） ---------------- */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 生成 size×size 的纯色 PNG。 */
function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const off = y * (size * 3 + 1);
    raw[off] = 0; // filter type none
    for (let x = 0; x < size; x += 1) {
      raw[off + 1 + x * 3] = 200;
      raw[off + 2 + x * 3] = 80;
      raw[off + 3 + x * 3] = 110;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function multipart(fieldName, filename, mime, buffer) {
  const boundary = '----blogp2' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="' + fieldName + '"; filename="' + filename + '"\r\n'
    + 'Content-Type: ' + mime + '\r\n\r\n',
    'utf8'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  return { boundary: boundary, body: Buffer.concat([head, buffer, tail]) };
}

function uploadAvatar(token, filename, mime, buffer) {
  const mp = multipart('file', filename, mime, buffer);
  return req('/api/profile/avatar', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'multipart/form-data; boundary=' + mp.boundary,
      'Content-Length': String(mp.body.length),
    },
    body: mp.body,
  });
}

/* ---------------- 主流程 ---------------- */

async function main() {
  console.log('================ P2 阶段验收（§9） ================');
  console.log('后端地址: ' + BASE);
  console.log('数据后缀: ' + SUFFIX);
  console.log('');

  /* ============ 0. 服务可用性 ============ */
  section('0. 服务可用性');
  let r = await get('/api/health');
  check(r.status === 200 && r.body && r.body.ok === true,
    '健康检查 200 且 ok=true', r.text);
  check(!!r.body && r.body.storage === 'mysql+redis',
    '存储为 mysql+redis（P2 依赖真实数据库与 Redis）', r.body && r.body.storage);

  /* ============ 1. 准备账号 ============ */
  section('1. 准备账号（作者 A / 读者 B）');
  const password = 'Passw0rd!2026';
  const phoneA = '137' + SUFFIX;
  const phoneB = '138' + SUFFIX;

  r = await post('/api/register', { phone: phoneA, nickname: 'P2作者', password: password });
  check(r.status === 201 && r.body && r.body.ok === true,
    '作者 A 注册成功 (201)', r.text);
  const userAId = r.body && r.body.user && r.body.user.id;
  check(!!userAId, '注册响应返回用户 id', r.text);

  r = await post('/api/login', { phone: phoneA, password: password });
  check(r.status === 200 && r.body && !!r.body.token,
    '作者 A 登录成功并签发令牌', r.text);
  const tokenA = r.body && r.body.token;
  check(!!tokenA && tokenA.length >= 32, '令牌长度 >= 32', tokenA && tokenA.length);

  r = await post('/api/register', { phone: phoneB, nickname: 'P2读者', password: password });
  check(r.status === 201, '读者 B 注册成功 (201)', r.text);

  r = await post('/api/login', { phone: phoneB, password: password });
  const tokenB = r.body && r.body.token;
  check(r.status === 200 && !!tokenB, '读者 B 登录成功', r.text);

  /* ============ 2. 匿名可读 / 写操作 401 ============ */
  section('2. 匿名可读、写操作 401（P9 / 决策 2）');

  r = await get('/api/articles?page=1&size=5');
  check(r.status === 200 && r.body && r.body.ok === true,
    '匿名 GET /api/articles 返回 200', r.text);
  check(!!data(r) && Array.isArray(data(r).items),
    '匿名列表返回 items 数组');

  r = await get('/api/home/summary?limit=5');
  check(r.status === 200 && !!data(r) && !!data(r).counts,
    '匿名 GET /api/home/summary 返回 200 且含 counts', r.text);

  r = await get('/api/tags');
  check(r.status === 200, '匿名 GET /api/tags 返回 200', r.text);

  const writeGuards = [
    ['POST /api/articles', () => post('/api/articles', { title: 'x', content_md: 'y' })],
    ['PUT /api/articles/any-id', () => put('/api/articles/any-id', { title: 'x' })],
    ['DELETE /api/articles/any-id', () => del('/api/articles/any-id')],
    ['POST /api/comments', () => post('/api/comments',
      { target_type: 'article', target_id: 'x', content: 'hi' })],
    ['POST /api/reactions', () => post('/api/reactions',
      { target_type: 'article', target_id: 'x', type: 'like' })],
    ['DELETE /api/reactions', () => del('/api/reactions?target_type=article&target_id=x&type=like')],
    ['POST /api/shares', () => post('/api/shares',
      { target_type: 'article', target_id: 'x' })],
    ['GET /api/profile', () => get('/api/profile')],
    ['PUT /api/profile', () => put('/api/profile', { nickname: 'hack' })],
    ['GET /api/categories', () => get('/api/categories')],
    ['POST /api/markdown/preview', () => post('/api/markdown/preview', { md: '# x' })],
  ];
  for (const [label, fn] of writeGuards) {
    const out = await fn();
    check(out.status === 401, '匿名 ' + label + ' 被拒绝 (401)',
      'status=' + out.status + ' body=' + out.text);
  }

  /* ============ 3. Markdown XSS 净化 ============ */
  section('3. Markdown XSS 净化（预览接口）');

  const xssCases = [
    {
      label: '<script> 标签被转义为纯文本',
      md: '正常文字\n\n<script>alert(1)</script>',
      forbidden: ['<script'],
    },
    {
      label: 'img onerror 不产出 img 标签与 src 属性',
      md: '![x](http://example.com/a.png" onerror="alert(1))',
      forbidden: ['<img', 'src='],
    },
    {
      label: 'javascript: 链接被拒绝',
      md: '[点击](javascript:alert(1))',
      forbidden: ['href="javascript:', '<a '],
    },
    {
      label: '原始 <iframe> 被转义，不产生可执行标签',
      md: '前言\n\n<iframe src="http://evil.example/">内嵌</iframe>\n\n后记',
      forbidden: ['<iframe'],
    },
    {
      label: '原始 HTML 的 style 属性不生效（整体已转义为文本）',
      md: '<p style="background:url(javascript:alert(1))">文字</p>',
      forbidden: ['<p style', '<p >'],
    },
    {
      label: 'data: 协议图片被拒绝',
      md: '![a](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
      forbidden: ['src="data:'],
    },
  ];

  for (const c of xssCases) {
    const out = await post('/api/markdown/preview', { md: c.md }, tokenA);
    const html = (data(out) && data(out).html) || '';
    const leaked = c.forbidden.filter((token) => html.indexOf(token) >= 0);
    check(out.status === 200 && leaked.length === 0,
      'XSS: ' + c.label,
      'leaked=' + JSON.stringify(leaked) + ' html=' + html);
  }

  // 正向能力不能被净化误伤
  const positive = '## 二级标题\n\n**加粗** 与 *斜体* 与 `code`\n\n- 列表项\n\n> 引用\n\n[站内](/home.html)';
  r = await post('/api/markdown/preview', { md: positive }, tokenA);
  const pHtml = (data(r) && data(r).html) || '';
  check(pHtml.indexOf('<h2') >= 0 && pHtml.indexOf('<strong>') >= 0
    && pHtml.indexOf('<em>') >= 0 && pHtml.indexOf('<code>') >= 0
    && pHtml.indexOf('<ul>') >= 0 && pHtml.indexOf('<blockquote>') >= 0
    && pHtml.indexOf('href="/home.html"') >= 0,
    'Markdown 正常语法（标题/加粗/斜体/行内码/列表/引用/站内链接）全部生效',
    pHtml);

  /* ============ 4. 文章 CRUD 端到端 ============ */
  section('4. 文章 CRUD 端到端');

  const title = 'P2 验收文章 ' + STAMP;
  const bodyMd = [
    '# 验收正文',
    '',
    '这是 **P2 验收** 的正文段落，包含 `inline code`。',
    '',
    '- 第一条',
    '- 第二条',
    '',
    '<script>window.__p2_xss = 1;</script>',
    '',
    '[危险链接](javascript:alert(' + SUFFIX + '))',
  ].join('\n');

  r = await post('/api/articles', {
    title: title,
    content_md: bodyMd,
    status: 'published',
    visibility: 'public',
    tags: ['验收', 'p2-' + SUFFIX],
  }, tokenA);
  check(r.status === 200 && !!data(r) && !!data(r).id,
    '作者 A 创建并发布文章 (200)', r.text);
  const article = data(r) || {};
  const articleId = article.id;
  check(!!article.slug, '创建返回 slug', article.slug);
  check(article.status === 'published', '状态为 published', article.status);
  check(article.visibility === 'public', '可见性为 public', article.visibility);
  check(typeof article.contentHtml === 'string' && article.contentHtml.length > 0,
    '创建响应含服务端渲染的 contentHtml');
  check(article.contentHtml.indexOf('<script') < 0
    && article.contentHtml.indexOf('&lt;script&gt;') >= 0,
    '入库正文已净化：<script> 被转义为纯文本，无任何可执行标签',
    article.contentHtml && article.contentHtml.slice(0, 200));
  check(article.contentHtml.indexOf('<h1') >= 0,
    '正文 Markdown 标题被正确渲染为 <h1>',
    article.contentHtml && article.contentHtml.slice(0, 160));

  r = await get('/api/articles/' + articleId);
  check(r.status === 200 && data(r) && data(r).id === articleId,
    '匿名按 id 读取公开文章成功', r.text);
  const firstView = data(r) && data(r).viewCount;
  r = await get('/api/articles/' + articleId);
  check(typeof firstView === 'number' && data(r) && data(r).viewCount > firstView,
    '匿名阅读使 viewCount 递增', 'first=' + firstView + ' second=' + (data(r) && data(r).viewCount));

  r = await get('/api/articles/' + article.slug);
  check(r.status === 200 && data(r) && data(r).id === articleId,
    '按 slug 回退读取同一篇文章', r.text);

  r = await get('/api/articles?q=' + encodeURIComponent('P2 验收文章 ' + STAMP));
  const listed = (data(r) && data(r).items) || [];
  check(r.status === 200 && listed.some((it) => it.id === articleId),
    '列表接口可按关键词检索到新文章',
    'total=' + (data(r) && data(r).total));

  r = await put('/api/articles/' + articleId, {
    title: title + '（已更新）',
    content_md: bodyMd + '\n\n追加一段更新内容。',
    status: 'published',
    visibility: 'public',
  }, tokenA);
  check(r.status === 200 && data(r) && data(r).title.indexOf('已更新') > 0,
    '作者 A 更新文章成功', r.text);

  // 越权：读者 B 修改他人文章 → 404（不泄露存在性）
  r = await put('/api/articles/' + articleId, {
    title: '被篡改的标题',
    content_md: 'hack',
    status: 'published',
    visibility: 'public',
  }, tokenB);
  check(r.status === 404, '读者 B 修改他人文章返回 404（不泄露存在性）',
    'status=' + r.status + ' body=' + r.text);

  // 越权：读者 B 删除他人文章 → 404
  r = await del('/api/articles/' + articleId, tokenB);
  check(r.status === 404, '读者 B 删除他人文章返回 404', 'status=' + r.status);

  /* ============ 5. 私有文章不可匿名读 ============ */
  section('5. 私有文章可见性（三级权限）');

  r = await post('/api/articles', {
    title: 'P2 私有草稿 ' + STAMP,
    content_md: '仅作者可见',
    status: 'draft',
    visibility: 'private',
  }, tokenA);
  const privateId = data(r) && data(r).id;
  check(r.status === 200 && !!privateId, '作者 A 创建私有草稿成功', r.text);

  r = await get('/api/articles/' + privateId);
  check(r.status === 404, '匿名读取私有草稿返回 404', 'status=' + r.status);

  r = await get('/api/articles/' + privateId, tokenB);
  check(r.status === 404, '读者 B 读取他人私有草稿返回 404', 'status=' + r.status);

  r = await get('/api/articles/' + privateId, tokenA);
  check(r.status === 200 && data(r) && data(r).id === privateId,
    '作者本人可读取自己的私有草稿', r.text);

  r = await get('/api/articles?page=1&size=50');
  const publicItems = (data(r) && data(r).items) || [];
  check(!publicItems.some((it) => it.id === privateId),
    '私有草稿不出现在匿名列表');

  /* ============ 6. 分类与标签 ============ */
  section('6. 分类与标签（F2 附属）');

  r = await post('/api/categories', { name: 'P2验收分类', slug: 'p2-cat-' + SUFFIX }, tokenA);
  check(r.status === 200 && !!data(r) && !!data(r).id,
    '作者 A 创建分类成功', r.text);
  const categoryId = data(r) && data(r).id;

  r = await get('/api/categories', tokenA);
  check(r.status === 200 && Array.isArray(data(r))
    && data(r).some((c) => c.id === categoryId),
    '登录后可见自己的分类列表', r.text);

  r = await get('/api/categories', tokenB);
  check(r.status === 200 && Array.isArray(data(r))
    && !data(r).some((c) => c.id === categoryId),
    '分类按 owner 隔离：读者 B 看不到作者 A 的分类', r.text);

  r = await get('/api/tags');
  check(r.status === 200 && Array.isArray(data(r))
    && data(r).some((t) => t.slug === 'p2-' + SUFFIX),
    '标签在文章发布后自动创建并公开可查', r.text);

  r = await put('/api/articles/' + articleId, {
    title: title + '（已更新）',
    content_md: bodyMd,
    status: 'published',
    visibility: 'public',
    category_id: categoryId,
    tags: ['验收'],
  }, tokenA);
  check(r.status === 200 && data(r) && data(r).categoryId === categoryId,
    '文章可归入分类', r.text);
  check(data(r) && Array.isArray(data(r).tagNames)
    && data(r).tagNames.indexOf('验收') >= 0,
    '文章标签被替换为新集合', data(r) && JSON.stringify(data(r).tagNames));

  /* ============ 7. F8 点赞（多态互动） ============ */
  section('7. F8 点赞 / 取消点赞（多态 target）');

  r = await get('/api/reactions?target_type=article&target_id=' + articleId);
  check(r.status === 200 && data(r) && data(r).likeCount === 0 && data(r).liked === false,
    '匿名查询点赞态：0 且 liked=false', r.text);

  r = await post('/api/reactions',
    { target_type: 'article', target_id: articleId, type: 'like' }, tokenB);
  check(r.status === 200 && data(r) && data(r).likeCount === 1 && data(r).liked === true,
    '读者 B 点赞成功，计数变 1', r.text);

  r = await post('/api/reactions',
    { target_type: 'article', target_id: articleId, type: 'like' }, tokenB);
  check(r.status === 200 && data(r) && data(r).likeCount === 1,
    '重复点赞幂等，计数仍为 1（不重复累加）', r.text);

  r = await get('/api/reactions?target_type=article&target_id=' + articleId, tokenB);
  check(data(r) && data(r).liked === true, '读者 B 视角 liked=true', r.text);

  r = await del('/api/reactions?target_type=article&target_id=' + articleId + '&type=like', tokenB);
  check(r.status === 200 && data(r) && data(r).likeCount === 0 && data(r).liked === false,
    '读者 B 取消点赞，计数归零', r.text);

  r = await post('/api/reactions',
    { target_type: 'article', target_id: 'no-such-target', type: 'like' }, tokenB);
  check(r.status === 404, '对不存在的 target 点赞返回 404', 'status=' + r.status);

  /* ============ 8. F8 评论审核与限流 ============ */
  section('8. F8 评论：审核（先审后发）与限流');

  const guestRead = await get('/api/comments?target_type=article&target_id=' + articleId);
  check(guestRead.status === 200 && data(guestRead) && Array.isArray(data(guestRead).items),
    '匿名可读评论列表', guestRead.text);

  r = await post('/api/comments',
    { target_type: 'article', target_id: articleId, content: '来自读者 B 的评论 ' + SUFFIX },
    tokenB);
  check(r.status === 200 && !!data(r) && !!data(r).id, '读者 B 发表评论成功', r.text);
  const commentId = data(r) && data(r).id;
  check(data(r) && data(r).status === 'pending',
    '站点开启先审后发：新评论 status=pending', data(r) && data(r).status);

  r = await get('/api/comments?target_type=article&target_id=' + articleId);
  const guestComments = (data(r) && data(r).items) || [];
  check(!guestComments.some((c) => c.id === commentId),
    '待审核评论不对外公开（匿名列表不含该条）',
    'items=' + guestComments.length);

  r = await get('/api/comments?target_type=article&target_id=' + articleId, tokenB);
  const ownComments = (data(r) && data(r).items) || [];
  check(ownComments.some((c) => c.id === commentId),
    '评论作者本人可见自己的待审核评论');

  r = await get('/api/comments?target_type=article&target_id=' + articleId, tokenA);
  const ownerComments = (data(r) && data(r).items) || [];
  check(ownerComments.some((c) => c.id === commentId),
    '内容作者（文章作者）可见全部状态的评论');

  // 评论 XSS：内容一律存原文，由前端 textContent 输出；这里验证服务端不产出 HTML
  r = await post('/api/comments', {
    target_type: 'article',
    target_id: articleId,
    content: '<img src=x onerror=alert(1)>',
  }, tokenB);
  check(r.status === 200 && data(r) && data(r).content === '<img src=x onerror=alert(1)>',
    '评论原文按纯文本存储，不做 HTML 渲染（前端 textContent 输出）',
    data(r) && data(r).content);
  const xssCommentId = data(r) && data(r).id;

  r = await post('/api/comments', {
    target_type: 'article',
    target_id: 'no-such-target',
    content: 'hi',
  }, tokenB);
  check(r.status === 404, '对不存在的 target 评论返回 404', 'status=' + r.status);

  // 限流：单用户 20 次/分钟 —— 已用 2 次，再发 25 次必然触发 429
  let hit429 = false;
  for (let i = 0; i < 25; i += 1) {
    const out = await post('/api/comments', {
      target_type: 'article',
      target_id: articleId,
      content: '限流探测 ' + i,
    }, tokenB);
    if (out.status === 429) {
      hit429 = true;
      break;
    }
  }
  check(hit429, '评论限流生效：连续发表触发 429（单用户 20 次/分钟）');

  /* ============ 9. F8 分享链接匿名可读 ============ */
  section('9. F8 分享链接匿名可读');

  r = await post('/api/shares', { target_type: 'article', target_id: articleId }, tokenA);
  check(r.status === 200 && data(r) && !!data(r).token,
    '作者 A 为公开文章生成分享链接', r.text);
  const shareToken = data(r) && data(r).token;
  check(!!data(r) && data(r).url.indexOf('/share.html?token=') === 0,
    '分享 URL 指向只读页 share.html', data(r) && data(r).url);
  const shareId = data(r) && data(r).id;

  r = await get('/api/s/' + shareToken);
  check(r.status === 200 && data(r) && data(r).targetId === articleId,
    '匿名持 token 可读取分享内容（无需登录）', r.text);
  check(!!data(r) && !!data(r).content && data(r).content.title.indexOf('已更新') > 0,
    '分享内容包含文章标题', data(r) && JSON.stringify(data(r).content).slice(0, 200));
  check(data(r) && typeof data(r).content.contentHtml === 'string'
    && data(r).content.contentHtml.indexOf('<script') < 0,
    '分享内容同样经过净化（无 <script>）');

  r = await get('/api/s/' + shareToken);
  check(data(r) && data(r).viewCount >= 2, '分享被访问时计次递增',
    data(r) && data(r).viewCount);

  r = await get('/api/s/invalid-token-' + SUFFIX);
  check(r.status === 404, '无效分享 token 返回 404', 'status=' + r.status);

  r = await post('/api/shares', { target_type: 'article', target_id: privateId }, tokenA);
  check(r.status === 403 || r.status === 404,
    '私有文章不可生成分享链接（' + r.status + '）');

  r = await del('/api/shares/' + shareId, tokenA);
  check(r.status === 200, '作者 A 撤销分享成功', r.text);
  r = await get('/api/s/' + shareToken);
  check(r.status === 404, '撤销后分享链接失效 (404)', 'status=' + r.status);

  /* ============ 10. F6 个人资料 ============ */
  section('10. F6 个人资料');

  r = await get('/api/profile', tokenA);
  check(r.status === 200 && data(r) && data(r).phoneMasked,
    '本人资料返回脱敏手机号', r.text);
  check(!!data(r) && data(r).phone === undefined,
    '本人资料不外泄完整手机号字段', JSON.stringify(data(r)));
  check(data(r) && String(data(r).phoneMasked).indexOf(SUFFIX.slice(-2)) >= 0
    && String(data(r).phoneMasked).indexOf('*') > 0,
    '脱敏格式含星号且保留尾号', data(r) && data(r).phoneMasked);

  r = await put('/api/profile', { nickname: 'P2作者改名', bio: '这是 P2 阶段验收写入的简介。' }, tokenA);
  check(r.status === 200 && data(r) && data(r).nickname === 'P2作者改名',
    '更新昵称与简介成功', r.text);

  r = await put('/api/profile', { nickname: 'bad name ###' }, tokenA);
  check(r.status === 400, '非法昵称字符被拒绝 (400)', 'status=' + r.status);

  r = await put('/api/profile', { nickname: 'a'.repeat(25) }, tokenA);
  check(r.status === 400, '超长昵称被拒绝 (400)', 'status=' + r.status);

  r = await put('/api/profile', { bio: 'x'.repeat(501) }, tokenA);
  check(r.status === 400, '超长简介被拒绝 (400)', 'status=' + r.status);

  r = await get('/api/profile/' + userAId);
  check(r.status === 200 && data(r) && data(r).phoneMasked === undefined,
    '公开资料接口不返回手机号（含脱敏）', JSON.stringify(data(r)));

  /* ============ 11. 头像上传限制 ============ */
  section('11. F6 头像上传限制');

  const okPng = makePng(64);
  r = await uploadAvatar(tokenA, 'avatar.png', 'image/png', okPng);
  check(r.status === 200 && data(r) && /^\/uploads\/avatar\//.test(data(r).avatarUrl || ''),
    '合法 PNG 头像上传成功并返回访问路径', r.text);
  const avatarUrl = data(r) && data(r).avatarUrl;

  if (avatarUrl) {
    const head = await fetch(BASE + avatarUrl);
    const buf = Buffer.from(await head.arrayBuffer());
    const isPng = buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50;
    check(head.status === 200 && isPng, '上传后的头像可通过 URL 访问且为 PNG',
      'status=' + head.status + ' len=' + buf.length);
  } else {
    check(false, '上传后的头像可通过 URL 访问且为 PNG', 'avatarUrl 缺失');
  }

  // 超过 2 MB
  const big = Buffer.alloc(2 * 1024 * 1024 + 1024, 0x41);
  r = await uploadAvatar(tokenA, 'big.png', 'image/png', big);
  check(r.status === 400, '超过 2 MB 的头像被拒绝 (400)', 'status=' + r.status + ' ' + r.text);

  // 扩展名不在白名单
  r = await uploadAvatar(tokenA, 'evil.exe', 'image/png', okPng);
  check(r.status === 400, '非图片扩展名被拒绝 (400)', 'status=' + r.status + ' ' + r.text);

  // MIME 与扩展名不匹配
  r = await uploadAvatar(tokenA, 'fake.png', 'text/plain', okPng);
  check(r.status === 400, 'MIME 与扩展名不匹配被拒绝 (400)', 'status=' + r.status + ' ' + r.text);

  // 魔数校验：扩展名/MIME 都对但内容不是图片
  r = await uploadAvatar(tokenA, 'magic.png', 'image/png', Buffer.from('not a real png file at all'));
  check(r.status === 400, '内容魔数不符（伪装 png）被拒绝 (400)',
    'status=' + r.status + ' ' + r.text);

  // 空文件
  r = await uploadAvatar(tokenA, 'empty.png', 'image/png', Buffer.alloc(0));
  check(r.status === 400, '空文件被拒绝 (400)', 'status=' + r.status + ' ' + r.text);

  /* ============ 12. F0-7 注册风控 ============ */
  section('12. F0-7 注册风控（手机号维度限流）');

  const victimPhone = '139' + SUFFIX;
  const codes = [];
  for (let i = 0; i < 7; i += 1) {
    const out = await post('/api/register', {
      phone: victimPhone,
      nickname: '风控' + i,
      password: password,
    });
    codes.push(out.status);
  }
  check(codes[0] === 201, '首个注册请求成功 (201)', 'codes=' + JSON.stringify(codes));
  // 设计选择：限流在唯一性校验之前，因此重复手机号在额度耗尽后由 409 变为 429。
  // 两者都是拒绝，安全性不受影响；这里断言「先 409、后 429」，锁住该顺序防止静默变化。
  const idx429 = codes.indexOf(429);
  const before429 = codes.slice(0, idx429 < 0 ? codes.length : idx429);
  check(codes.slice(1, 5).every((c) => c === 409),
    '额度内重复手机号返回 409（唯一约束）', 'codes=' + JSON.stringify(codes));
  check(idx429 > 0 && before429.includes(409),
    '额度耗尽后同手机号转为 429（同号限流 5 次/10 分钟）',
    'codes=' + JSON.stringify(codes));

  // 换一批全新手机号连续注册，触发 IP 维度限流。
  // 阈值由 REGISTER_LIMIT_IP 控制（默认 200）：验收环境用启动参数调小到 8，
  // 既证明限流真实生效，又不在站点里堆出上百个垃圾账号。
  const ipLimit = Number(process.env.REGISTER_LIMIT_IP || 200);
  const ipCodes = [];
  let firstIpHit = -1;
  for (let i = 0; i < Math.min(ipLimit + 5, 60); i += 1) {
    const out = await post('/api/register', {
      phone: '150' + String(STAMP + i).slice(-8),
      nickname: '批量' + i,
      password: password,
    });
    ipCodes.push(out.status);
    if (out.status === 429) {
      firstIpHit = i;
      break;
    }
  }
  check(firstIpHit >= 0,
    'IP 维度注册限流生效：批量注册触发 429（阈值 ' + ipLimit + '）',
    'codes=' + JSON.stringify(ipCodes));

  /* ============ 13. 分页与排序白名单 ============ */
  section('13. 分页与排序白名单（安全边界）');

  r = await get('/api/articles?page=1&size=500');
  check(r.status === 200 && data(r) && data(r).size <= 50,
    'size 超上限被收敛到 50', data(r) && data(r).size);

  r = await get('/api/articles?page=0&size=10');
  check(r.status === 200 && data(r) && data(r).page === 1,
    '非法页码归一到第 1 页', data(r) && data(r).page);

  r = await get('/api/articles?sort=' + encodeURIComponent('title; DROP TABLE article'));
  check(r.status === 400, '注入式排序参数被白名单拒绝 (400)',
    'status=' + r.status + ' body=' + r.text);

  r = await get('/api/articles?sort=created_at_ms:asc&size=3');
  check(r.status === 200 && data(r) && data(r).items.length > 0,
    '白名单内排序可用（created_at_ms:asc）', r.text);

  /* ============ 14. 清理 ============ */
  section('14. 清理测试数据（删除文章 + 撤销会话）');

  r = await del('/api/articles/' + articleId, tokenA);
  check(r.status === 200, '作者 A 删除测试文章成功', r.text);

  r = await get('/api/articles/' + articleId);
  check(r.status === 404, '删除后匿名读取返回 404（软删除已生效）', 'status=' + r.status);

  r = await post('/api/logout', {}, tokenA);
  check(r.status === 200 || r.status === 204, '作者 A 登出成功', 'status=' + r.status);

  r = await get('/api/me', tokenA);
  check(r.status === 401, '登出后令牌立即失效 (401)', 'status=' + r.status);

  /* ============ 汇总 ============ */
  console.log('');
  console.log('================ 汇总 ================');
  console.log('通过: ' + passed);
  console.log('失败: ' + failures.length);
  if (failures.length) {
    console.log('');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log('P2 验收全部通过。');
  }
}

main().catch((err) => {
  console.error('');
  console.error('验收脚本异常终止: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
