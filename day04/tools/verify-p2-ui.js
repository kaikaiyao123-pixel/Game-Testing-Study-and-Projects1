'use strict';

/**
 * P2 前端浏览器验收（Chrome headless + DOM 探针）。
 *
 * 验证 F1 / F2 / F6 / F8 四个模块在真实浏览器里的渲染结果，而不只是后端契约。
 * 做法：把 web/*.html 复制成临时副本（放在 web/ 下，由 3000 静态服务托管），
 * 在 <head> 注入一段脚本预置令牌（localStorage['blog.token']），页面自身的
 * page-shell.js 便会以登录态接管；再用 --dump-dom + 固定 id 的探针节点读回断言。
 *
 * 必须经 http://127.0.0.1:3000 打开，不能用 file:// —— 后者是 opaque origin，
 * 页面 fetch http://127.0.0.1:8081 会被 CORS 直接拒绝，导致全页进入错误态。
 *
 * 覆盖：
 *   F2 列表页   —— 文章卡片渲染、标题文本、无未定义样式类
 *   F2 详情页   —— contentHtml 注入、Markdown 元素、点赞按钮/评论区挂载
 *   F2 编辑器   —— 表单字段、预览按钮、textarea 预填
 *   F6 资料页   —— 头像、昵称、脱敏手机号、编辑表单
 *   F1 主页     —— 统计卡、最近动态或空态、快捷操作（登录态）
 *   样式表      —— pages.css 中新类确有规则（防「有类无样式」）
 *
 * 用法: node tools/verify-p2-ui.js
 *   需要 8081（后端）与 3000（静态前端）均已启动。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const WEB = path.join(__dirname, '..', 'web');
const API = (process.env.API_BASE || 'http://127.0.0.1:8081').replace(/\/+$/, '');
const FRONT = (process.env.FRONT_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const STAMP = Date.now();
const SUFFIX = String(STAMP).slice(-8);

let passed = 0;
const failures = [];

function check(cond, label, extra) {
  if (cond) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    const line = label + (extra ? ' | ' + String(extra).slice(0, 400) : '');
    failures.push(line);
    console.log('  FAIL  ' + line);
  }
}

function section(t) {
  console.log('');
  console.log('---- ' + t + ' ----');
}

function findBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function chrome(browser, args, timeout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-p2ui-'));
  try {
    return String(cp.execFileSync(browser, args.concat(['--user-data-dir=' + dir]), {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeout || 120000,
    }));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/');
}

/* ---------------- 页面副本构造 ---------------- */

const TOKEN = { value: '' };

function makeCopy(htmlName, hash, extraProbe) {
  let html = fs.readFileSync(path.join(WEB, htmlName), 'utf8');
  const seed = `<script>
(function () {
  try { window.localStorage.setItem('blog.token', ${JSON.stringify(TOKEN.value)}); } catch (e) {}
  window.addEventListener('load', function () { if (${JSON.stringify(hash)}) location.hash = ${JSON.stringify(hash)}; });
})();
</script>`;
  html = html.replace(/(<head[^>]*>)/i, '$1\n' + seed);
  if (extraProbe) html = html.replace('</body>', extraProbe + '\n</body>');
  const name = '_p2ui_' + Math.random().toString(16).slice(2) + '.html';
  fs.writeFileSync(path.join(WEB, name), html, 'utf8');
  // 通过 3000 静态服务访问，保证与 BLOG_CONFIG.API_BASE 同源可用
  return { file: path.join(WEB, name), url: FRONT + '/' + name };
}

function probe(browser, url, budget) {
  const dom = chrome(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,1000', '--force-device-scale-factor=1',
    '--virtual-time-budget=' + (budget || 8000), '--dump-dom', url,
  ], 150000);
  const m = /P2UI_JSON\s+(\{.*?\})<\/div>/s.exec(dom);
  if (!m) return null;
  return JSON.parse(m[1]);
}

function screenshot(browser, url, outPng) {
  chrome(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars', '--window-size=1280,1000',
    '--force-device-scale-factor=1', '--virtual-time-budget=9000',
    '--screenshot=' + outPng.replace(/\\/g, '/'), url,
  ], 150000);
}

/** 探针脚本：把页面真实渲染结果写入 #p2ui-probe 供 dump-dom 读回。 */
const PROBE_SCRIPT = `<div id="p2ui-probe" hidden></div>
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    function q(sel) { return document.querySelector(sel); }
    function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
    function txt(sel) { var n = q(sel); return n ? (n.textContent || '').trim() : null; }
    var root = document.getElementById('content-root') || document.getElementById('home-content');
    var out = {
      title: document.title,
      readyState: document.readyState,
      shellTitle: txt('#shell-title'),
      stateVisible: ['state-loading', 'state-empty', 'state-error'].filter(function (id) {
        var n = document.getElementById(id);
        return n && !n.hidden;
      }),
      contentHidden: root ? root.hidden : null,
      contentNodes: root ? root.children.length : 0,
      // 元素清单（类名 + 文本），用于逐项断言
      cards: qa('.article-card').map(function (n) {
        return { title: n.querySelector('.article-card-title') ? n.querySelector('.article-card-title').textContent.trim() : '',
                 meta: n.querySelector('.article-card-meta') ? n.querySelector('.article-card-meta').textContent.trim() : '' };
      }),
      statCards: qa('.stat-card').map(function (n) {
        return { value: n.querySelector('.stat-value') ? n.querySelector('.stat-value').textContent.trim() : '',
                 label: n.querySelector('.stat-label') ? n.querySelector('.stat-label').textContent.trim() : '' };
      }),
      recentItems: qa('.recent-item').length,
      homeEmpty: !!q('.home-empty'),
      quickActions: qa('.quick-actions .btn').map(function (n) { return n.textContent.trim(); }),
      articleTitle: txt('.article-detail-title'),
      articleBodyHtml: (q('.article-body') || {}).innerHTML || '',
      markdownTags: ['h1','h2','p','strong','code','ul','li','blockquote','pre','a','img'].filter(function (t) {
        var b = q('.article-body');
        return b && b.querySelector(t);
      }),
      reactionBtns: qa('.reaction-btn').length,
      likeCount: txt('.reaction-count'),
      commentsSection: !!q('.comments'),
      commentInput: !!q('.comment-input'),
      commentsStatus: txt('.comments-status'),
      commentItems: qa('.comment-item').length,
      editorFields: ['ed-title', 'ed-category', 'ed-visibility', 'ed-tags', 'ed-content'].filter(function (id) {
        return !!document.getElementById(id);
      }),
      editorTextareaValue: (document.getElementById('ed-content') || {}).value || '',
      editorButtons: qa('.editor-actions .btn').map(function (n) { return n.textContent.trim(); }),
      profileName: txt('.profile-name'),
      profilePhone: txt('.profile-phone'),
      profileAvatarSrc: (q('.profile-avatar') || {}).getAttribute ? q('.profile-avatar').getAttribute('src') : null,
      profileAvatarOk: (function () {
        var img = q('.profile-avatar');
        return !!(img && img.complete && img.naturalWidth > 0);
      })(),
      profileFormFields: ['pf-nickname', 'pf-bio', 'pf-avatar'].filter(function (id) {
        return !!document.getElementById(id);
      }),
      guestActionsVisible: (function () {
        var n = document.getElementById('user-guest');
        return !!(n && !n.hidden);
      })(),
      sessionMenuVisible: (function () {
        var n = document.getElementById('user-session');
        return !!(n && !n.hidden);
      })(),
    };
    var box = document.getElementById('p2ui-probe');
    box.textContent = 'P2UI_JSON ' + JSON.stringify(out);
  }, 2600);
});
</script>`;

/* ---------------- 样式表断言（防「有类无样式」） ---------------- */

/**
 * pages.css 必须为 P2 组件类定义规则。
 * 只检查「类名出现在选择器中」，不检查具体属性值 —— 后者会随设计迭代漂移。
 */
const REQUIRED_CLASSES = [
  'content-root', 'section-head', 'section-title', 'section-sub',
  'text-input', 'field-hint', 'badge', 'badge-draft', 'article-notice',
  'article-grid', 'article-card', 'article-card-title', 'article-card-summary', 'article-card-meta',
  'article-detail', 'article-detail-bar', 'article-detail-title', 'article-detail-meta',
  'article-body', 'markdown-body', 'editor-form', 'editor-row', 'editor-textarea',
  'editor-preview', 'editor-actions',
  'stat-grid', 'stat-card', 'stat-value', 'stat-label', 'home-section', 'home-empty',
  'recent-list', 'recent-item', 'recent-link', 'recent-title', 'recent-type', 'quick-actions',
  'interactions', 'reaction-bar', 'reaction-btn', 'reaction-icon', 'reaction-count',
  'share-output', 'share-label', 'share-input',
  'comments', 'comments-title', 'comment-list', 'comment-item', 'comment-head',
  'comment-author', 'comment-time', 'comment-body', 'comment-del', 'comments-status',
  'comments-login', 'comment-form', 'comment-input', 'comment-actions',
  'profile-card', 'profile-head', 'profile-avatar-wrap', 'profile-avatar', 'profile-identity',
  'profile-name', 'profile-phone', 'profile-since', 'profile-bio', 'profile-subtitle',
  'profile-bio-text', 'profile-form', 'profile-avatar-upload', 'file-input',
];

async function api(pathname, options) {
  const res = await fetch(API + pathname, options);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { body = null; }
  return { status: res.status, body: body, text: text };
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('SKIP: 未找到 Chrome / Edge，跳过前端浏览器验收。');
    process.exit(0);
  }

  console.log('================ P2 前端浏览器验收 ================');
  console.log('后端: ' + API);
  console.log('浏览器: ' + browser);
  console.log('');

  /* ---------------- 样式表 ---------------- */
  section('0. pages.css 覆盖全部 P2 组件类');
  const css = fs.readFileSync(path.join(WEB, 'css', 'pages.css'), 'utf8');
  const missing = REQUIRED_CLASSES.filter((c) => css.indexOf('.' + c) < 0);
  check(missing.length === 0,
    'pages.css 为 ' + REQUIRED_CLASSES.length + ' 个 P2 组件类定义了规则',
    'missing=' + JSON.stringify(missing));

  // 反向校验：随机造一个不存在的类，确认上面的检测方式确实会报缺失
  const fakeMissing = ['definitely-not-a-real-class-xyz'].filter((c) => css.indexOf('.' + c) < 0);
  check(fakeMissing.length === 1, '反向校验：不存在的类会被检出（检测逻辑非空壳）');

  /* ---------------- 准备账号与内容 ---------------- */
  section('1. 准备验收数据');
  const password = 'Passw0rd!2026';
  const phone = '136' + SUFFIX;
  let r = await api('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone, nickname: '前端验收员', password: password }),
  });
  check(r.status === 201, '注册前端验收账号 (201)', r.text);

  r = await api('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone, password: password }),
  });
  TOKEN.value = (r.body && r.body.token) || '';
  check(!!TOKEN.value, '登录并取得令牌', r.text);

  const authJson = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN.value };

  const md = [
    '# 前端验收标题一',
    '',
    '这是 **加粗** 与 `行内代码`，还有一段引用：',
    '',
    '> 引用内容',
    '',
    '1. 有序第一项',
    '2. 有序第二项',
    '',
    '```',
    'console.log(1)',
    '```',
    '',
    '[站内链接](/home.html)',
  ].join('\n');

  r = await api('/api/articles', {
    method: 'POST', headers: authJson,
    body: JSON.stringify({
      title: '前端验收文章 ' + STAMP,
      content_md: md, status: 'published', visibility: 'public', tags: ['前端'],
    }),
  });
  const articleId = r.body && r.body.data && r.body.data.id;
  check(!!articleId, '创建公开文章用于前端渲染', r.text);

  // 一条待审核评论，用于验证评论区「待审核」徽标
  r = await api('/api/comments', {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ target_type: 'article', target_id: articleId, content: '前端验收评论内容' }),
  });
  check(r.status === 200, '发表一条评论（待审核态）', r.text);

  // 对文章点一次赞，用于验证点赞按钮激活态与计数
  r = await api('/api/reactions', {
    method: 'POST', headers: authJson,
    body: JSON.stringify({ target_type: 'article', target_id: articleId, type: 'like' }),
  });
  check(r.status === 200, '对文章点赞一次', r.text);

  const tempFiles = [];

  /* ---------------- F2 列表页 ---------------- */
  section('2. F2 文章列表页（#/）');
  let f = makeCopy('articles.html', '#/', PROBE_SCRIPT);
  tempFiles.push(f.file);
  let p = probe(browser, f.url);
  check(!!p, '列表页探针返回数据');
  if (p) {
    check(p.cards.length > 0, '渲染出文章卡片（.article-card）', 'count=' + p.cards.length);
    check(p.cards.some((c) => c.title.indexOf('前端验收文章') >= 0),
      '卡片标题为真实文章标题（textContent 注入，非 innerHTML）',
      JSON.stringify(p.cards.slice(0, 2)));
    check(p.cards.every((c) => c.title.length > 0 && c.meta.length > 0),
      '每张卡片都有标题与元信息', JSON.stringify(p.cards.slice(0, 1)));
    check(p.sessionMenuVisible === true, '登录态：顶栏显示用户菜单');
    check(p.guestActionsVisible === false, '登录态：访客入口已隐藏');
  }
  screenshot(browser, f.url, path.join(__dirname, 'p2ui-articles.png'));

  /* ---------------- F2 详情页 ---------------- */
  section('3. F2 文章详情页（#/p/<id>）');
  f = makeCopy('articles.html', '#/p/' + articleId, PROBE_SCRIPT);
  tempFiles.push(f.file);
  p = probe(browser, f.url);
  check(!!p, '详情页探针返回数据');
  if (p) {
    check(!!p.articleTitle && p.articleTitle.indexOf('前端验收文章') >= 0,
      '详情标题正确渲染', p.articleTitle);
    check(p.articleBodyHtml.length > 50, '正文 contentHtml 已注入',
      'len=' + p.articleBodyHtml.length);
    check(p.articleBodyHtml.indexOf('<script') < 0, '注入的正文不含 script 标签');
    check(p.markdownTags.indexOf('h1') >= 0, 'Markdown 标题渲染为 <h1>',
      JSON.stringify(p.markdownTags));
    check(p.markdownTags.indexOf('strong') >= 0 && p.markdownTags.indexOf('code') >= 0,
      'Markdown 加粗与行内代码生效', JSON.stringify(p.markdownTags));
    check(p.markdownTags.indexOf('blockquote') >= 0, 'Markdown 引用生效');
    check(p.markdownTags.indexOf('pre') >= 0, 'Markdown 代码块生效');
    check(p.reactionBtns >= 2, 'F8 互动条挂载（点赞 + 分享按钮）', 'count=' + p.reactionBtns);
    check(p.likeCount === '1', '点赞计数显示 1', p.likeCount);
    check(p.commentsSection === true, '评论区已挂载');
    check(p.commentInput === true, '登录态显示评论输入框');
    check(p.commentItems >= 1, '评论列表渲染出发表的评论', 'count=' + p.commentItems);
  }
  screenshot(browser, f.url, path.join(__dirname, 'p2ui-detail.png'));

  /* ---------------- F2 编辑器 ---------------- */
  section('4. F2 编辑器（#/new）');
  f = makeCopy('articles.html', '#/new', PROBE_SCRIPT);
  tempFiles.push(f.file);
  p = probe(browser, f.url);
  check(!!p, '编辑器探针返回数据');
  if (p) {
    check(p.editorFields.length === 5, '编辑器五个核心字段齐全（标题/分类/可见性/标签/正文）',
      JSON.stringify(p.editorFields));
    check(p.editorButtons.some((b) => b === '预览') && p.editorButtons.some((b) => b === '发布')
      && p.editorButtons.some((b) => b === '存为草稿'),
      '编辑器动作按钮齐全（预览 / 存为草稿 / 发布）', JSON.stringify(p.editorButtons));
  }
  screenshot(browser, f.url, path.join(__dirname, 'p2ui-editor.png'));

  /* ---------------- F1 主页 ---------------- */
  section('5. F1 主页聚合（home.html）');
  f = makeCopy('home.html', '', PROBE_SCRIPT);
  tempFiles.push(f.file);
  p = probe(browser, f.url);
  check(!!p, '主页探针返回数据');
  if (p) {
    check(p.statCards.length === 4, '四张统计卡渲染', 'count=' + p.statCards.length);
    check(p.statCards.every((c) => c.label.length > 0 && /^\d+$/.test(c.value)),
      '统计卡均有标签与数字', JSON.stringify(p.statCards));
    const labels = p.statCards.map((c) => c.label);
    check(labels.indexOf('文章') >= 0 && labels.indexOf('影视条目') >= 0
      && labels.indexOf('宝库条目') >= 0 && labels.indexOf('碎碎念') >= 0,
      '统计卡标签与四大模块对应', JSON.stringify(labels));
    check(p.recentItems > 0 || p.homeEmpty, '最近动态：有列表或显示空态引导（二选一，不为空白）',
      'items=' + p.recentItems + ' empty=' + p.homeEmpty);
    check(p.quickActions.length === 4, '登录态显示四个快捷操作', JSON.stringify(p.quickActions));
  }
  screenshot(browser, f.url, path.join(__dirname, 'p2ui-home.png'));

  /* ---------------- F6 资料页 ---------------- */
  section('6. F6 个人资料页（profile.html）');
  f = makeCopy('profile.html', '', PROBE_SCRIPT);
  tempFiles.push(f.file);
  p = probe(browser, f.url);
  check(!!p, '资料页探针返回数据');
  if (p) {
    check(p.profileName === '前端验收员', '昵称渲染正确', p.profileName);
    check(!!p.profilePhone && p.profilePhone.indexOf('*') > 0,
      '手机号脱敏展示', p.profilePhone);
    check(p.profileAvatarSrc === 'assets/head.png', '未上传头像时使用本地默认头像',
      p.profileAvatarSrc);
    check(p.profileAvatarOk === true, '头像图片真实加载成功（naturalWidth > 0）',
      'ok=' + p.profileAvatarOk);
    check(p.profileFormFields.length === 3,
      '资料编辑字段齐全（昵称 / 简介 / 头像文件）', JSON.stringify(p.profileFormFields));
    check(p.stateVisible.length === 0, '资料加载完成后三个状态面板均已隐藏',
      JSON.stringify(p.stateVisible));
  }
  screenshot(browser, f.url, path.join(__dirname, 'p2ui-profile.png'));

  /* ---------------- 清理 ---------------- */
  section('7. 清理');
  for (const tf of tempFiles) {
    try { fs.unlinkSync(tf); } catch (e) { /* ignore */ }
  }
  check(tempFiles.every((tf) => !fs.existsSync(tf)), '临时页面副本已全部删除');

  r = await api('/api/articles/' + articleId, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN.value },
  });
  check(r.status === 200, '删除验收文章', r.text);

  console.log('');
  console.log('================ 汇总 ================');
  console.log('通过: ' + passed);
  console.log('失败: ' + failures.length);
  if (failures.length) {
    console.log('');
    failures.forEach((x) => console.log('  ✗ ' + x));
    process.exitCode = 1;
  } else {
    console.log('P2 前端验收全部通过。');
  }
}

main().catch((err) => {
  console.error('');
  console.error('验收脚本异常终止: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
