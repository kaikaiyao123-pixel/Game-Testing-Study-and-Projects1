'use strict';

/**
 * P2 布局契约探针 —— 不依赖后端 / 数据库 / 登录态。
 *
 * 背景：P2 前端验收截图发现「区块标题被壁纸文字遮住」与「空态面板残留」，
 * 根因是 #content-root 落在 .shell-card 之外，文字直接压在动态壁纸上。
 * 修复是把功能内容移进玻璃卡内。本脚本用真实浏览器几何断言证明该修复，
 * 并防止后续改动把内容区再挪出去。
 *
 * 做法：生成 web/ 下的临时副本（由 3000 静态服务托管，避免 file:// 的
 * opaque origin），移除所有会发 API 请求的业务脚本，只保留 HTML + CSS，
 * 由探针脚本注入一段代表性内容，再用 --dump-dom 把几何结果读回。
 *
 * 用法: node tools/verify-p2-layout.js
 *   仅需 3000 静态前端；不需要 8081 / MySQL / Redis。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const WEB = path.join(__dirname, '..', 'web');
const FRONT = (process.env.FRONT_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
// 全部业务脚本都剥离：只验证 HTML 结构 + CSS 布局，不触发任何 API 请求，
// 也避免 background.js 在无视频帧时挂载不透明背景层把内容盖住。
const KEEP_SCRIPTS = /^$/;
const tempFiles = [];

let passed = 0;
const failures = [];

function check(cond, label, extra) {
  if (cond) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    const line = label + (extra ? ' | ' + String(extra).slice(0, 300) : '');
    failures.push(line);
    console.log('  FAIL  ' + line);
  }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-p2layout-'));
  try {
    return String(cp.execFileSync(browser, args.concat(['--user-data-dir=' + dir]), {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeout || 120000,
    }));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

const PROBE = `
<script>
window.addEventListener('load', function () {
  var root = document.getElementById('content-root');
  var card = document.querySelector('.shell-card');
  var ids = ['state-loading', 'state-empty', 'state-error'];
  ids.forEach(function (id) { var n = document.getElementById(id); if (n) n.hidden = true; });
  root.hidden = false;

  // 代表性内容由 makeCopy() 静态写入 HTML，截图与 dump-dom 看到的是同一份 DOM。
  var title = document.querySelector('.section-title');
  var r = root.getBoundingClientRect();
  var c = card.getBoundingClientRect();
  var t = title.getBoundingClientRect();
  var inCard = function (box) {
    return box.left >= c.left - 1 && box.right <= c.right + 1 &&
           box.top >= c.top - 1 && box.bottom <= c.bottom + 1;
  };
  var titleStyle = getComputedStyle(title);
  var rootStyle = getComputedStyle(root);
  var bodyStyle = getComputedStyle(document.body);

  var wanted = ['.article-grid', '.article-card', '.section-head', '.section-title',
                '.article-notice', '.stat-grid', '.profile-card', '.reaction-bar', '.comment-item'];
  var found = [];
  for (var s = 0; s < document.styleSheets.length; s += 1) {
    var sheet = document.styleSheets[s];
    var rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    if (!rules) continue;
    for (var i = 0; i < rules.length; i += 1) {
      var sel = rules[i].selectorText || '';
      wanted.forEach(function (w) {
        if (sel.indexOf(w) >= 0 && found.indexOf(w) < 0) found.push(w);
      });
    }
  }

  var noticeSel = root.querySelector('[id]') ?
    document.querySelectorAll('#article-notice, #profile-notice').length : 0;
  var out = {
    parentClass: root.parentElement ? root.parentElement.className : '',
    parentIsCard: !!(root.parentElement && root.parentElement.classList.contains('shell-card')),
    contentVisible: !root.hidden,
    statesHidden: ids.every(function (id) {
      var n = document.getElementById(id); return !n || n.hidden;
    }),
    titleInCard: inCard(t),
    rootInCard: inCard(r),
    titleColor: titleStyle.color,
    titleOpacity: titleStyle.opacity,
    bodyVisible: bodyStyle.visibility === 'visible' && bodyStyle.display !== 'none',
    titleVisible: titleStyle.visibility === 'visible' && titleStyle.display !== 'none'
                  && Number(titleStyle.opacity) > 0
                  && rootStyle.visibility === 'visible',
    cardBg: getComputedStyle(card).backgroundColor,
    rootBg: rootStyle.backgroundColor,
    noticeCount: noticeSel,
    styleRules: found,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    runtimeErrors: window.__p2layoutErrors || []
  };
  var d = document.createElement('div');
  d.id = 'P2LAYOUT_JSON';
  d.textContent = JSON.stringify(out);
  document.body.appendChild(d);
});
</script>`;

const SAMPLE = `
        <div class="section-head">
          <div><h2 class="section-title">全部文章</h2><p class="section-sub">共 1 篇</p></div>
        </div>
        <div class="article-grid">
          <article class="article-card">
            <h3 class="article-card-title">布局探针文章</h3>
            <p class="article-card-summary">用于验证内容区是否落在玻璃卡内部，标题不再压在动态壁纸上。</p>
          </article>
        </div>`;

/** 生成副本：保留 HTML/CSS，剥离会请求 API 的业务脚本，并静态化「内容已渲染」状态。 */
function makeCopy(page, injectDuplicateNotice, keepGuardPending) {
  let html = fs.readFileSync(path.join(WEB, page), 'utf8');
  html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, function (all, src) {
    return KEEP_SCRIPTS.test(src) ? all : '';
  });
  // auth-guard.js 正常会在鉴权完成后摘掉 guard-pending；剥离脚本后需自行模拟，
  // 否则 body.guard-pending { visibility:hidden } 会让整页不可见。
  if (!keepGuardPending) {
    html = html.replace(/(<body[^>]*class="[^"]*)\s*guard-pending/, '$1');
  }
  // 模拟 page-shell 完成接管后的 DOM：收起加载态、显示内容区。
  html = html.replace('<div class="state-pane" id="state-loading" role="status">',
    '<div class="state-pane" id="state-loading" role="status" hidden>');
  html = html.replace('<div class="content-root" id="content-root" hidden>',
    '<div class="content-root" id="content-root">');
  html = html.replace(/(<p class="article-notice" id="(?:article|profile)-notice"[^>]*><\/p>)/,
    '$1' + SAMPLE);
  if (injectDuplicateNotice) {
    html = html.replace('</body>',
      '<p class="article-notice" id="article-notice" hidden></p>\n</body>');
  }
  html = html.replace('</body>', PROBE + '\n</body>');
  const name = '_p2layout_' + Math.random().toString(16).slice(2) + '.html';
  const file = path.join(WEB, name);
  fs.writeFileSync(file, html, 'utf8');
  tempFiles.push(file);
  return FRONT + '/' + name;
}

const BASE_ARGS = [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--no-first-run', '--autoplay-policy=no-user-gesture-required',
  '--hide-scrollbars', '--window-size=1280,1000', '--force-device-scale-factor=1',
];

function run(browser, url, screenshot) {
  const dom = chrome(browser, BASE_ARGS.concat([
    '--virtual-time-budget=3500', '--dump-dom', url,
  ]), 150000);
  if (screenshot) {
    // 截图调用刻意不带 --autoplay-policy：该参数与 --virtual-time-budget 组合时，
    // 本机会截到空白首帧（实测 5.8KB 纯色图）。dump-dom 通道不受影响。
    chrome(browser, BASE_ARGS.filter((a) => a !== '--autoplay-policy=no-user-gesture-required')
      .concat([
        '--virtual-time-budget=9000',
        '--screenshot=' + screenshot.replace(/\\/g, '/'), url,
      ]), 150000);
  }
  const m = /<div id="P2LAYOUT_JSON">([^<]*)<\/div>/.exec(dom);
  if (!m) return null;
  try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); }
  catch (e) { return null; }
}

(function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('未找到 Chrome / Edge，无法运行布局探针');
    process.exit(1);
  }
  // 自愈：Windows 下上一轮的副本可能因 Chrome / 静态服务句柄延迟释放而残留，
  // 本轮启动时先扫掉，保证 web/ 目录始终干净。
  let stale = 0;
  for (const name of fs.readdirSync(WEB)) {
    if (!/^_p2layout_[0-9a-f]+\.html$/.test(name)) continue;
    try { fs.rmSync(path.join(WEB, name), { force: true }); stale += 1; }
    catch (e) { /* 下轮再试 */ }
  }

  console.log('================ P2 布局契约探针 ================');
  console.log('浏览器: ' + browser);
  if (stale) console.log('已清理上一轮残留副本: ' + stale + ' 个');
  console.log('静态源: ' + FRONT + '（不需要后端）');

  try {
    for (const page of ['articles.html', 'profile.html']) {
      console.log('');
      console.log('---- ' + page + ' ----');
      const url = makeCopy(page, false);
      const shot = path.join(__dirname,
        'p2layout-' + page.replace('.html', '') + '.png');
      const p = run(browser, url, shot);
      check(!!p, 'DOM 探针成功回传结果');
      if (!p) continue;

      check(p.parentIsCard, '#content-root 的直接父元素是 .shell-card', p.parentClass);
      check(p.contentVisible && p.statesHidden,
        '功能内容可见且三态面板全部收起（无空态残留）');
      check(p.rootInCard, '内容区几何完全落在玻璃卡矩形内');
      check(p.titleInCard, '区块标题几何落在玻璃卡内（不再压在壁纸上）');
      check(p.titleOpacity !== '0' && p.titleColor !== 'rgba(0, 0, 0, 0)',
        '标题文字不透明、有实际颜色', p.titleColor + ' / opacity=' + p.titleOpacity);
      check(p.bodyVisible && p.titleVisible,
        '整页与标题实际可见（guard-pending 已解除）',
        'body=' + p.bodyVisible + ' title=' + p.titleVisible);
      check(p.rootBg === 'rgba(0, 0, 0, 0)' || p.rootBg === 'transparent',
        '内容区不再自带第二层卡片底色', p.rootBg);
      check(p.noticeCount === 1, '通知节点 id 唯一（无重复 id）', 'count=' + p.noticeCount);
      check(p.styleRules.length >= 9,
        'pages.css 中 P2 组件类均有样式规则', p.styleRules.join(','));
      check(p.overflowX <= 0, '无横向溢出', 'overflowX=' + p.overflowX);
    }

    // 反向注入：人为制造重复 id，探针必须检出，证明断言不是空壳
    console.log('');
    console.log('---- 反向注入（证明探针有效） ----');
    const badUrl = makeCopy('articles.html', true);
    const bad = run(browser, badUrl, null);
    check(!!bad && bad.noticeCount > 1,
      '注入重复 #article-notice 后探针检出重复 id',
      bad && ('count=' + bad.noticeCount));

    const hiddenUrl = makeCopy('articles.html', false, true);
    const hidden = run(browser, hiddenUrl, null);
    check(!!hidden && hidden.bodyVisible === false,
      '保留 guard-pending 时探针检出整页不可见（几何断言无法覆盖的盲区）',
      hidden && ('bodyVisible=' + hidden.bodyVisible));

    console.log('');
    console.log('==================================================');
    console.log('结果: 通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
    if (failures.length) {
      failures.forEach((f) => console.log('  - ' + f));
      console.log('结论: 布局契约未通过');
      process.exitCode = 1;
    } else {
      console.log('结论: 布局契约通过（内容区已收进玻璃卡，标题对比度有保障）');
    }
  } finally {
    // Windows 下 Chrome / 静态服务会短暂持有副本句柄，unlinkSync 可能失败。
    // 原实现把异常静默吞掉，实测每次运行残留 4 个 web/_p2layout_*.html。
    // 改为有限重试 + 同步等待，并对仍未清理的文件显式告警。
    const nap = new Int32Array(new SharedArrayBuffer(4));
    const leftover = [];
    tempFiles.forEach((f) => {
      let removed = false;
      for (let i = 0; i < 6 && !removed; i += 1) {
        try { fs.rmSync(f, { force: true }); } catch (e) { /* 等句柄释放后重试 */ }
        // Windows delete-pending 下 existsSync 会误报「已删除」，改用目录枚举判定。
        removed = !fs.readdirSync(WEB).includes(path.basename(f));
        if (!removed) Atomics.wait(nap, 0, 0, 80);
      }
      if (!removed) leftover.push(f);
    });
    if (leftover.length) {
      console.log('警告：以下临时副本未能自动清理，请手动删除：');
      leftover.forEach((f) => console.log('  - ' + f));
    } else {
      console.log('临时副本已全部清理（' + tempFiles.length + ' 个）');
    }
  }
})();
