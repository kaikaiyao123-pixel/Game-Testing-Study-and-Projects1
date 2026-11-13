'use strict';

/**
 * UI 改版专项验收（真实 Chrome/Edge headless + DOM 探针 + 视觉预览）。
 *
 * 覆盖：
 *   1. 头像 / 壁纸封面图片真的加载成功（naturalWidth > 0）
 *   2. 动态壁纸视频真的解码并播放（分辨率 / readyState / 时间轴推进 / 3~6s 片段循环）
 *   3. 主导航 5 项文案、头像下拉列表、退出登录收纳在下拉底部
 *   4. 头像下拉的真实点击交互（展开 / 点击外部收起 / aria-expanded 同步）
 *   5. 无关脚标已移除、零外部资源引用、Canvas 光效层与遮罩存在
 *   6. 卡片水平居中、无横向溢出、双页布局尺寸
 *   7. 反向注入：头像失效、切回静态模式无视频、移除 site.js 顶栏交互层后下拉不展开、
 *      篡改片段区间；P1 新增：导航改回禁用态 / 下拉改回禁用态 / 删除访客态顶栏 三类断言非空壳验证
 *   8. 输出三张页面预览图（登录页 / 主页 / 下拉展开态）
 *
 * 用法: node tools/ui-probe.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const TOOLS = path.join(ROOT, 'tools');

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findBrowser() {
  return BROWSER_CANDIDATES.find((c) => fs.existsSync(c)) || null;
}

const PROBE_SCRIPT = `<script>
(function () {
  var errors = [];
  window.addEventListener('error', function (e) { errors.push(String(e.message || e)); });

  function videoState() {
    var v = document.querySelector('.bg-video');
    if (!v) return null;
    return {
      t: Number(v.currentTime.toFixed(3)),
      rs: v.readyState,
      paused: v.paused,
      w: v.videoWidth,
      h: v.videoHeight,
      loop: v.loop,
      muted: v.muted,
      fit: getComputedStyle(v).objectFit,
      soften: v.classList.contains('is-loop-soften'),
      clipStart: v.dataset.clipStart === undefined ? null : Number(v.dataset.clipStart),
      clipEnd: v.dataset.clipEnd === undefined ? null : Number(v.dataset.clipEnd),
      src: v.getAttribute('src') || '',
      absSrc: v.currentSrc || '',
      err: v.error ? v.error.code : null,
    };
  }
  var videoEarly = videoState();

  // 主页预览副本移除了 home.js，这里手动挂载背景以便验证与截图
  try {
    var layer = document.getElementById('bg-layer');
    if (layer && !document.querySelector('.bg-wallpaper') && window.BlogBackground && window.BLOG_CONFIG) {
      window.BlogBackground.mount(layer, window.BLOG_CONFIG.BACKGROUND);
    }
  } catch (e) { errors.push('mount: ' + e); }

  // 片段循环采样：记录整段时间轴，用于证明「越界回跳」真实发生
  var clipSamples = [];
  var clipVideo = null;
  function startClipSampling() {
    clipVideo = document.querySelector('.bg-video');
    if (!clipVideo) return;
    clipVideo.addEventListener('timeupdate', function () {
      clipSamples.push(Number(clipVideo.currentTime.toFixed(3)));
    });
    // 专用副本把时间推近片段末尾，迫使回跳在验收窗口内发生（不受解码速度影响）
    if (window.__UI_PROBE_NUDGE_CLIP__) {
      function nudge() {
        var end = Number(clipVideo.dataset.clipEnd);
        if (isFinite(end) && end > 0 && clipVideo.readyState >= 1) {
          try { clipVideo.currentTime = end - 0.15; } catch (e) {}
        }
      }
      if (clipVideo.readyState >= 1) nudge();
      else clipVideo.addEventListener('loadedmetadata', nudge, { once: true });
    }
  }
  startClipSampling();

  function rectOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left) };
  }

  function finish() {
    var card = document.querySelector('.auth-card');
    var wall = document.querySelector('.bg-wallpaper');
    var faces = [].slice.call(document.querySelectorAll('.auth-avatar, .brand-avatar, .avatar'));
    var refs = [].slice.call(document.querySelectorAll('[src],[href]'))
      .map(function (el) { return el.getAttribute('src') || el.getAttribute('href') || ''; });
    var canvas = document.querySelector('.bg-canvas');
    var cr = card ? card.getBoundingClientRect() : null;

    // 头像下拉的真实交互：仅在存在下拉结构的页面上执行
    var menuProbe = null;
    var mBtn = document.getElementById('user-menu-btn');
    var dd = document.getElementById('user-dropdown');
    if (mBtn && dd) {
      var wasHidden = dd.hidden;
      mBtn.click();
      var opened = { hidden: dd.hidden, expanded: mBtn.getAttribute('aria-expanded') };
      document.body.click();
      var closed = { hidden: dd.hidden, expanded: mBtn.getAttribute('aria-expanded') };
      menuProbe = { wasHidden: wasHidden, opened: opened, closed: closed };
    }
    var ddItems = dd ? [].slice.call(dd.querySelectorAll('.dropdown-item')) : [];

    // ---- P1：导航可用性、下拉可用性、访客态顶栏、品牌一致性 ----
    var navItems = [].slice.call(document.querySelectorAll('.nav-link')).map(function (n) {
      return {
        tag: n.tagName,
        href: n.getAttribute('href') || '',
        text: n.textContent.trim(),
        disabled: n.getAttribute('aria-disabled') === 'true' || n.classList.contains('is-muted'),
      };
    });
    var ddListItems = dd ? [].slice.call(dd.querySelectorAll('.dropdown-list .dropdown-item')) : [];
    var dropdownLinks = ddListItems.map(function (n) {
      var label = n.querySelector('.item-label') || n;
      return {
        tag: n.tagName,
        href: n.getAttribute('href') || '',
        text: label.textContent.trim(),
        disabled: n.getAttribute('aria-disabled') === 'true' || n.classList.contains('is-muted'),
      };
    });
    var guestBox = document.getElementById('user-guest');
    var sessionBox = document.getElementById('user-session');
    var guestLinks = guestBox ? [].slice.call(guestBox.querySelectorAll('a')) : [];
    var brandEl = document.querySelector('.brand-name');

    var d = {
      title: document.title,
      viewport: [window.innerWidth, window.innerHeight],
      scrollWidth: document.documentElement.scrollWidth,
      card: rectOf(card),
      centerOffsetX: cr ? Math.round(cr.left + cr.width / 2 - window.innerWidth / 2) : null,
      topbar: rectOf(document.querySelector('.topbar-inner')),
      hero: rectOf(document.querySelector('.hero')),
      faceTotal: faces.length,
      faceLoaded: faces.filter(function (i) { return i.complete && i.naturalWidth > 0; }).length,
      faceNatural: faces.map(function (i) { return i.naturalWidth; }),
      wallpaperLoaded: !!(wall && wall.complete && wall.naturalWidth > 0),
      wallpaperNatural: wall ? wall.naturalWidth + 'x' + wall.naturalHeight : 'none',
      canvasCount: document.querySelectorAll('.bg-canvas').length,
      canvasPixels: canvas ? canvas.width + 'x' + canvas.height : 'none',
      veilCount: document.querySelectorAll('.bg-veil').length,
      videoCount: document.querySelectorAll('.bg-video').length,
      video: videoState(),
      videoEarly: videoEarly,
      clip: {
        start: clipVideo ? (clipVideo.dataset.clipStart === undefined ? null : Number(clipVideo.dataset.clipStart)) : null,
        end: clipVideo ? (clipVideo.dataset.clipEnd === undefined ? null : Number(clipVideo.dataset.clipEnd)) : null,
        samples: clipSamples,
        final: clipVideo ? Number(clipVideo.currentTime.toFixed(3)) : null,
        loop: clipVideo ? clipVideo.loop : null,
      },
      underlayCount: document.querySelectorAll('.bg-wallpaper.is-underlay').length,
      navLabels: [].slice.call(document.querySelectorAll('.nav-link'))
        .map(function (n) { return n.textContent.trim(); }),
      dropdownCount: document.querySelectorAll('.user-dropdown').length,
      logoutInDropdown: dd ? !!dd.querySelector('#btn-logout') : false,
      logoutTotal: document.querySelectorAll('#btn-logout').length,
      dropdownLogoutAtBottom: ddItems.length > 0 &&
        ddItems[ddItems.length - 1].id === 'btn-logout',
      menu: menuProbe,
      externalRefs: refs.filter(function (v) { return /^https?:/i.test(v); }).length,
      removed: {
        copyright: !!document.querySelector('.copyright'),
        hint: !!document.querySelector('.hint'),
        eyebrow: !!document.querySelector('.eyebrow'),
        placeholder: !!document.querySelector('.placeholder-card'),
        brandMark: !!document.querySelector('.brand-mark'),
      },
      tabs: document.querySelectorAll('.tab').length,
      forms: document.querySelectorAll('form').length,
      footLinks: document.querySelectorAll('.auth-foot a').length,
      navCount: document.querySelectorAll('.nav-link').length,
      navItems: navItems,
      dropdownLinks: dropdownLinks,
      guestActions: {
        exists: !!guestBox,
        visible: !!guestBox && !guestBox.hidden,
        loginHref: guestLinks[0] ? (guestLinks[0].getAttribute('href') || '') : '',
        registerHref: guestLinks[1] ? (guestLinks[1].getAttribute('href') || '') : '',
      },
      sessionBoxHidden: !!sessionBox && sessionBox.hidden,
      brandName: brandEl ? brandEl.textContent.trim() : '',
      poem: (function () {
        var p = document.getElementById('home-poem');
        if (!p) return null;
        var lines = [].slice.call(p.querySelectorAll('.poem-line'));
        var chars = [].slice.call(p.querySelectorAll('.poem-char'));
        return {
          label: p.getAttribute('aria-label') || '',
          dataText: lines.map(function (l) { return l.getAttribute('data-text') || ''; }),
          lineCount: lines.length,
          charCount: chars.length,
          delays: chars.map(function (s) {
            return parseFloat(getComputedStyle(s).animationDelay) || 0;
          }),
          staticMode: p.classList.contains('is-static'),
        };
      })(),
      cover: rectOf(document.querySelector('.cover')),
      heroTop: (function () {
        var h = document.querySelector('.hero');
        return h ? Math.round(h.getBoundingClientRect().top) : null;
      })(),
      underlayBlur: (function () {
        var u = document.querySelector('.bg-wallpaper.is-underlay');
        return u ? getComputedStyle(u).filter : '';
      })(),
      underlayAnim: (function () {
        var u = document.querySelector('.bg-wallpaper.is-underlay');
        return u ? getComputedStyle(u).animationName : '';
      })(),
      veilAnim: (function () {
        var v = document.querySelector('.bg-veil');
        return v ? getComputedStyle(v).animationName : '';
      })(),
      errors: errors,
      audio: (function () {
        var a = document.getElementById('bg-audio');
        var btn = document.getElementById('audio-toggle');
        return {
          exists: !!a,
          src: a ? (a.getAttribute('src') || '') : '',
          loop: a ? a.loop : null,
          paused: a ? a.paused : null,
          btnExists: !!btn,
          btnPressed: btn ? btn.getAttribute('aria-pressed') : null,
        };
      })(),
    };

    var out = document.createElement('div');
    out.id = 'ui-probe-result';
    out.textContent = 'UI_PROBE_JSON ' + JSON.stringify(d);
    document.body.appendChild(out);
  }

  // 视频解码与播放需要时间；默认 1600ms，专用副本可调长以覆盖一次片段回跳
  var finishDelay = Number(window.__UI_PROBE_FINISH_MS__) || 1600;
  if (document.readyState === 'complete') setTimeout(finish, finishDelay);
  else window.addEventListener('load', function () { setTimeout(finish, finishDelay); });
})();
</script>`;

/**
 * 主页静态副本：移除守卫、顶栏交互层 site.js 与 home.js，避免探针被重定向、
 * 也避免下拉交互干扰「无脚本时点击不展开」的反向断言。
 * 背景层由 PROBE_SCRIPT 的兜底 mount 或截图 DEMO 手动挂载。
 */
function homeTransform(html) {
  return html
    .replace('class="guard-pending"', 'class=""')
    .replace('<script src="js/auth-guard.js"></script>', '')
    .replace('<script src="js/site.js"></script>', '')
    .replace('<script src="js/home.js"></script>', '');
}

/** 登录态 stub：保留 site.js / home.js，用本地数据驱动双态渲染，不发真实请求。 */
const HOME_GUARD_STUB = `<script>
window.BlogGuard = {
  optionalLogin: function () { return Promise.resolve({
    guest: false,
    user: { nickname: '绘梨衣', phone: '138****8000' },
    session: { createdAt: '2026-11-11T01:52:00Z', expiresAt: '2026-11-18T01:52:00Z' }
  }); },
  requireLogin: function () { return Promise.resolve(null); }
};
if (window.BlogApi) {
  window.BlogApi.siteConfig = function () { return Promise.reject(new Error('ui-probe-stub')); };
}
</script>`;

/** 访客态 stub：驱动真实 site.js / home.js 后，登录态下拉不应出现。 */
const HOME_GUEST_STUB = `<script>
window.BlogGuard = {
  optionalLogin: function () { return Promise.resolve({ guest: true, user: null, session: null }); },
  requireLogin: function () { return Promise.resolve(null); }
};
if (window.BlogApi) {
  window.BlogApi.siteConfig = function () { return Promise.reject(new Error('ui-probe-stub')); };
}
</script>`;

function homeMenuTransform(html) {
  return html
    .replace('class="guard-pending"', 'class=""')
    .replace('<script src="js/auth-guard.js"></script>', HOME_GUARD_STUB);
}

function homeGuestTransform(html) {
  return html
    .replace('class="guard-pending"', 'class=""')
    .replace('<script src="js/auth-guard.js"></script>', HOME_GUEST_STUB);
}

/** 截图 DEMO 公共片段：手动挂载背景 + 设置登录态顶栏。 */
const HOME_DEMO_HEAD = `<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  window.BlogBackground.mount($('bg-layer'), window.BLOG_CONFIG.BACKGROUND);
  // 截图是静态媒介：复用「减少动态效果」样式，展示诗句动画完成态
  $('home-poem').classList.add('is-static');
  $('user-session').hidden = false;
  $('user-guest').hidden = true;
  $('user-name').textContent = '绘梨衣';
  $('dropdown-name').textContent = '绘梨衣';
  $('dropdown-phone').textContent = '138****8000';
  $('welcome-title').textContent = '欢迎回来，绘梨衣';
  $('welcome-desc').textContent = '你已通过服务端会话校验，可以开始管理你的博客内容。';
  $('meta-phone').textContent = '138****8000';
  $('meta-created').textContent = '2026/11/11 01:52';
  $('meta-expires').textContent = '2026/11/18 01:52';
`;

const HOME_DEMO = HOME_DEMO_HEAD + `})();
</script>`;

/** 下拉展开态截图：同一份示例数据 + 手动展开下拉。 */
const HOME_MENU_DEMO = HOME_DEMO_HEAD + `  $('user-dropdown').hidden = false;
  $('user-menu-btn').classList.add('is-open');
  $('user-menu-btn').setAttribute('aria-expanded', 'true');
})();
</script>`;

/** 访客态主页截图：站点简介 + 登录 / 注册入口，登录态用户区隐藏。 */
const HOME_GUEST_DEMO = `<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  window.BlogBackground.mount($('bg-layer'), window.BLOG_CONFIG.BACKGROUND);
  $('home-poem').classList.add('is-static');
  $('user-guest').hidden = false;
  $('user-session').hidden = true;
  $('welcome-title').textContent = '欢迎来到 炫与梓';
  $('welcome-desc').textContent = '一个关于记录、收藏与日常的地方。公开内容无需登录即可浏览。';
  $('hero-session').hidden = true;
  $('hero-guest').hidden = false;
})();
</script>`;

/** 反向注入副本：强制切回静态壁纸模式，证明「视频播放」断言不是永远通过。 */
const NO_VIDEO_INJECT = `<script>
(function () {
  var layer = document.getElementById('bg-layer');
  if (layer) layer.innerHTML = '';
  window.BLOG_CONFIG.BACKGROUND.type = 'wallpaper';
  window.BlogBackground.mount(layer, window.BLOG_CONFIG.BACKGROUND);
})();
</script>`;

/** 专用副本：延长探针窗口并推近片段末尾，用于验证 3~6s 区间循环与越界回跳。 */
const CLIP_INJECT = `<script>
window.__UI_PROBE_FINISH_MS__ = 3000;
window.__UI_PROBE_NUDGE_CLIP__ = true;
</script>`;

/** 反向注入副本：篡改片段区间标记，探针应检出「不再是 3~6s」。 */
const BAD_CLIP_INJECT = `<script>
window.addEventListener('load', function () {
  var v = document.querySelector('.bg-video');
  if (v) { v.dataset.clipStart = '0'; v.dataset.clipEnd = '10'; }
});
</script>`;

/**
 * 启动一次 headless Chrome。
 *
 * 注意：这里刻意不删除 --user-data-dir 临时目录。环境的 safe-delete 守卫是按「回合」
 * 累计删除数判定的（阈值 50）：一次验收会启动十余次 Chrome，若每次都递归删除 profile
 * 目录，删除计数会被推到 80+，导致后续清理 web/_ui_*.html 副本被判为批量删除而拒绝，
 * finally 抛错后即使 77 项断言全绿，脚本仍以 exit 1 误报失败。
 * profile 目录留在系统临时目录，交由操作系统回收即可。
 */
function chrome(browser, args, timeout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-ui-'));
  return String(cp.execFileSync(browser, args.concat(['--user-data-dir=' + dir]), {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeout || 90000,
  }));
}

function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/');
}

function probe(browser, htmlFile, budget) {
  const dom = chrome(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,900', '--force-device-scale-factor=1',
    '--virtual-time-budget=' + (budget || 6000), '--dump-dom', fileUrl(htmlFile),
  ], 120000);
  const m = /UI_PROBE_JSON\s+(\{.*?\})<\/div>/s.exec(dom);
  if (!m) throw new Error('未读到 UI_PROBE_JSON');
  return JSON.parse(m[1]);
}

function screenshot(browser, htmlFile, outPng) {
  chrome(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--hide-scrollbars', '--window-size=1280,900',
    '--force-device-scale-factor=1', '--virtual-time-budget=6000',
    '--screenshot=' + outPng.replace(/\\/g, '/'), fileUrl(htmlFile),
  ], 120000);
}

function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('SKIP: 未找到 Chrome / Edge，跳过 UI 浏览器验收。');
    process.exit(0);
  }

  const tempFiles = [
    '_ui_login_probe.html', '_ui_home_probe.html', '_ui_broken_probe.html',
    '_ui_no_video_probe.html', '_ui_home_menu_probe.html',
    '_ui_clip_probe.html', '_ui_bad_clip_probe.html',
    // P1 新增：访客态驱动副本 + 3 类断言非空壳反向注入
    '_ui_guest_probe.html', '_ui_nav_broken_probe.html',
    '_ui_dropdown_broken_probe.html', '_ui_guest_broken_probe.html',
    '_ui_poem_broken_probe.html',
    '_ui_login_preview.html', '_ui_home_preview.html', '_ui_home_menu_preview.html',
    '_ui_home_guest_preview.html',
  ];

  const loginSrc = fs.readFileSync(path.join(WEB, 'login.html'), 'utf8');
  const homeSrc = fs.readFileSync(path.join(WEB, 'home.html'), 'utf8');

  // 启动自愈：上次被中断遗留的 _ui_*.html 副本会干扰探针，先尝试清理。
  // 清理失败只告警不阻断；同名副本随后也会被 writeFileSync 覆盖。
  fs.readdirSync(WEB).forEach(function (n) {
    if (!/^_ui_.*\.html$/.test(n)) return;
    try { fs.unlinkSync(path.join(WEB, n)); }
    catch (e) { console.warn('警告: 历史临时副本清理失败 -> ' + n + ': ' + e.message); }
  });

  try {
    // 探针副本
    fs.writeFileSync(path.join(WEB, '_ui_login_probe.html'),
      loginSrc.replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_home_probe.html'),
      homeTransform(homeSrc).replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_broken_probe.html'),
      loginSrc.replace('src="assets/head.png"', 'src="assets/__missing_head__.png"')
        .replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_no_video_probe.html'),
      loginSrc.replace('</body>', NO_VIDEO_INJECT + PROBE_SCRIPT + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_home_menu_probe.html'),
      homeMenuTransform(homeSrc).replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_clip_probe.html'),
      loginSrc.replace('</body>', CLIP_INJECT + PROBE_SCRIPT + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_bad_clip_probe.html'),
      loginSrc.replace('</body>', BAD_CLIP_INJECT + PROBE_SCRIPT + '\n</body>'), 'utf8');

    // ---- P1 新增副本 ----
    // 1) 访客态驱动：真实 site.js / home.js 运行后仍应保持访客态
    fs.writeFileSync(path.join(WEB, '_ui_guest_probe.html'),
      homeGuestTransform(homeSrc).replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');

    const staticHome = homeTransform(homeSrc);

    // 2) 导航反向注入：把「文章」改回 aria-disabled 静态文本
    const brokenNavHtml = staticHome.replace(
      '<a class="nav-link" data-nav="articles" href="articles.html">文章</a>',
      '<span class="nav-link is-muted" aria-disabled="true">文章</span>');
    if (brokenNavHtml === staticHome) throw new Error('导航反向注入失败：未命中目标链接');
    fs.writeFileSync(path.join(WEB, '_ui_nav_broken_probe.html'),
      brokenNavHtml.replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');

    // 3) 下拉反向注入：把「个人资料」改回禁用态
    const brokenDropdownHtml = staticHome.replace(
      '<a class="dropdown-item" role="menuitem" href="profile.html">',
      '<a class="dropdown-item is-muted" role="menuitem" aria-disabled="true">');
    if (brokenDropdownHtml === staticHome) throw new Error('下拉反向注入失败：未命中目标链接');
    fs.writeFileSync(path.join(WEB, '_ui_dropdown_broken_probe.html'),
      brokenDropdownHtml.replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');

    // 4) 访客态顶栏反向注入：整段删除 guest-actions
    const guestBlockRe = /<div class="guest-actions" id="user-guest">[\s\S]*?<\/div>\s*<!-- 登录态顶栏/;
    const brokenGuestHtml = staticHome.replace(guestBlockRe, '<!-- 登录态顶栏');
    if (brokenGuestHtml === staticHome) throw new Error('访客态反向注入失败：未命中目标区块');
    fs.writeFileSync(path.join(WEB, '_ui_guest_broken_probe.html'),
      brokenGuestHtml.replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');

    // 5) 首屏反向注入：移除逐字脚本 + 强制把视频改回 cover 裁切
    const poemBrokenHtml = staticHome
      .replace('<script src="js/poem.js"></script>', '')
      .replace('</head>', '<style>body[data-page="home"] .bg-video{object-fit:cover !important}</style>\n</head>');
    if (poemBrokenHtml === staticHome) throw new Error('首屏反向注入失败：未命中目标');
    fs.writeFileSync(path.join(WEB, '_ui_poem_broken_probe.html'),
      poemBrokenHtml.replace('</body>', PROBE_SCRIPT + '\n</body>'), 'utf8');

    // 截图预览副本（不含探针脚本，避免污染画面）
    fs.writeFileSync(path.join(WEB, '_ui_login_preview.html'), loginSrc, 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_home_preview.html'),
      homeTransform(homeSrc).replace('</body>', HOME_DEMO + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_home_menu_preview.html'),
      homeTransform(homeSrc).replace('</body>', HOME_MENU_DEMO + '\n</body>'), 'utf8');
    fs.writeFileSync(path.join(WEB, '_ui_home_guest_preview.html'),
      homeTransform(homeSrc).replace('</body>', HOME_GUEST_DEMO + '\n</body>'), 'utf8');

    const login = probe(browser, path.join(WEB, '_ui_login_probe.html'));
    const home = probe(browser, path.join(WEB, '_ui_home_probe.html'));
    const broken = probe(browser, path.join(WEB, '_ui_broken_probe.html'));
    const noVideo = probe(browser, path.join(WEB, '_ui_no_video_probe.html'));
    const homeMenu = probe(browser, path.join(WEB, '_ui_home_menu_probe.html'));
    const clipRun = probe(browser, path.join(WEB, '_ui_clip_probe.html'), 9000);
    const badClip = probe(browser, path.join(WEB, '_ui_bad_clip_probe.html'));
    const guestRun = probe(browser, path.join(WEB, '_ui_guest_probe.html'));
    const navBroken = probe(browser, path.join(WEB, '_ui_nav_broken_probe.html'));
    const dropdownBroken = probe(browser, path.join(WEB, '_ui_dropdown_broken_probe.html'));
    const guestBroken = probe(browser, path.join(WEB, '_ui_guest_broken_probe.html'));
    const poemBroken = probe(browser, path.join(WEB, '_ui_poem_broken_probe.html'));

    const shots = {
      login: path.join(TOOLS, 'ui-login.png'),
      home: path.join(TOOLS, 'ui-home.png'),
      homeMenu: path.join(TOOLS, 'ui-home-menu.png'),
      homeGuest: path.join(TOOLS, 'ui-home-guest.png'),
    };
    screenshot(browser, path.join(WEB, '_ui_login_preview.html'), shots.login);
    screenshot(browser, path.join(WEB, '_ui_home_preview.html'), shots.home);
    screenshot(browser, path.join(WEB, '_ui_home_menu_preview.html'), shots.homeMenu);
    screenshot(browser, path.join(WEB, '_ui_home_guest_preview.html'), shots.homeGuest);

    let passed = 0;
    const failures = [];
    function check(cond, label, extra) {
      if (cond) { passed += 1; console.log('  PASS  ' + label); }
      else { failures.push(label); console.log('  FAIL  ' + label + (extra ? ' | ' + extra : '')); }
    }
    function noFoot(d) {
      return !d.removed.copyright && !d.removed.hint && !d.removed.eyebrow &&
        !d.removed.placeholder && !d.removed.brandMark;
    }

    console.log('================ UI 改版浏览器验收 ================');
    console.log('浏览器: ' + path.basename(browser));
    console.log('登录页: 视口 ' + login.viewport.join('x') +
      ' | 卡片 ' + (login.card ? login.card.w + 'x' + login.card.h : '-') +
      ' | 中心偏移 ' + login.centerOffsetX + 'px' +
      ' | 头像 ' + login.faceLoaded + '/' + login.faceTotal +
      ' | 壁纸封面 ' + login.wallpaperNatural);
    console.log('动态视频: ' + (login.video
      ? login.video.w + 'x' + login.video.h + ' readyState=' + login.video.rs +
        ' paused=' + login.video.paused + ' t=' +
        (login.videoEarly ? login.videoEarly.t : '-') + '→' + login.video.t
      : '未挂载'));
    console.log('播放区间: ' + (login.clip
      ? login.clip.start + 's ~ ' + login.clip.end + 's' : '-') +
      ' | 采样峰值=' + (clipRun.clip && clipRun.clip.samples.length
        ? Math.max.apply(null, clipRun.clip.samples).toFixed(2) + 's' : '-') +
      ' | 回跳=' + (clipRun.clip && clipRun.clip.samples.some(function (v, i, a) {
        return i > 0 && v < a[i - 1] - 0.5;
      })) +
      ' | 采样=' + JSON.stringify(clipRun.clip ? clipRun.clip.samples : []));
    console.log('首屏诗句: ' + (home.poem ? home.poem.dataText.join(' / ') : '-') +
      ' | 逐字=' + (home.poem ? home.poem.charCount : 0) +
      ' | object-fit=' + (home.video ? home.video.fit : '-'));
    console.log('主导航: ' + home.navLabels.join(' / '));
    console.log('头像下拉: ' + (homeMenu.menu
      ? '默认收起=' + homeMenu.menu.wasHidden + ' 点击后展开=' + (!homeMenu.menu.opened.hidden)
      : '无数据'));
    console.log('');

    console.log('[登录页]');
    check(Math.abs(login.centerOffsetX) <= 2, '登录卡片水平居中', 'offset=' + login.centerOffsetX);
    check(login.scrollWidth <= login.viewport[0], '登录页无横向溢出', 'scrollWidth=' + login.scrollWidth);
    check(login.card && login.card.w > 300 && login.card.w <= 424, '卡片宽度符合设计约束', JSON.stringify(login.card));
    check(login.faceTotal === 1 && login.faceLoaded === 1 && login.faceNatural[0] === 320,
      '登录框头像 head.png 加载成功', JSON.stringify(login.faceNatural));
    check(login.wallpaperLoaded && login.wallpaperNatural === '1280x720',
      '指定壁纸封面已铺底（首帧 / 兜底）', login.wallpaperNatural);
    check(login.canvasCount >= 1 && login.canvasPixels !== 'none' && login.veilCount === 1,
      '动态光效层与遮罩均已挂载', login.canvasPixels + ' veil=' + login.veilCount);
    check(login.externalRefs === 0, '页面零外部资源引用', 'count=' + login.externalRefs);
    check(noFoot(login), '无关脚标已全部移除', JSON.stringify(login.removed));
    check(login.tabs === 2 && login.forms === 2 && login.footLinks === 2,
      '登录/注册交互结构完整', 'tabs=' + login.tabs + ' forms=' + login.forms);
    check(login.errors.length === 0, '登录页无运行时错误', JSON.stringify(login.errors));

    console.log('\n[动态壁纸视频]');
    check(login.videoCount === 1, '登录页已挂载动态壁纸视频层', 'count=' + login.videoCount);
    check(login.video && login.video.w === 1920 && login.video.h === 1080,
      '官方 1920x1080 动态壁纸解码成功',
      login.video ? login.video.w + 'x' + login.video.h : 'none');
    check(login.video && login.video.rs >= 2 && login.video.paused === false &&
      login.video.loop === false && login.video.muted === true,
      '视频正在播放（静音 / 内联 / 未暂停 / 关闭原生整段 loop）', JSON.stringify(login.video));
    check(login.clip && login.clip.start === 3 && login.clip.end === 6,
      '播放区间已配置为第 3s ~ 第 6s',
      JSON.stringify(login.clip && [login.clip.start, login.clip.end]));
    check(login.video && login.video.t >= 2.9 && login.video.t <= 6.6,
      '当前播放位置落在 3~6s 区间内', 't=' + (login.video ? login.video.t : '-'));
    check(login.video && login.videoEarly && login.video.t > login.videoEarly.t,
      '视频时间轴持续推进（壁纸本身在动）',
      (login.videoEarly ? login.videoEarly.t : '-') + '→' + (login.video ? login.video.t : '-'));
    check(login.video && /assets\/wallpaper-preview\.mp4$/.test(login.video.src) &&
      !/^https?:/i.test(login.video.absSrc),
      '视频源为本地 MP4，零外部依赖', login.video ? login.video.src : 'none');
    check(login.underlayCount === 1, '静态封面首帧兜底层已挂载', 'count=' + login.underlayCount);
    check(home.videoCount === 1 && home.video && home.video.paused === false,
      '主页同样播放动态壁纸视频', 'count=' + home.videoCount);

    console.log('\n[3~6s 片段循环]');
    const cs = clipRun.clip ? clipRun.clip.samples : [];
    const peak = cs.length ? Math.max.apply(null, cs) : -1;
    const loopedBack = cs.some(function (v, i, a) { return i > 0 && v < a[i - 1] - 0.5; });
    check(clipRun.clip && clipRun.clip.start === 3 && clipRun.clip.end === 6 &&
      clipRun.clip.loop === false,
      '专用副本确认 3~6s 区间且关闭原生 loop',
      JSON.stringify(clipRun.clip && [clipRun.clip.start, clipRun.clip.end, clipRun.clip.loop]));
    // headless 虚拟时间下 timeupdate 触发较稀疏（实测仅 2 次），
    // 故不断言采样数量，改为断言采样确实覆盖「片段末尾」与「回跳起点」两个关键时间点。
    check(cs.length >= 2 && cs.some(function (v) { return v >= 5.5; }) &&
      cs.some(function (v) { return v <= 3.6; }),
      '时间轴采样覆盖「片段末尾 → 回跳起点」两个关键时间点', JSON.stringify(cs));
    check(peak >= 5.5 && peak <= 6.6, '播放推进到片段末尾附近（未越过第 6s）', 'peak=' + peak);
    check(loopedBack === true, '越过第 6s 后确实回跳到起点（片段循环生效）',
      JSON.stringify(cs));
    check(clipRun.clip && clipRun.clip.final >= 2.9 && clipRun.clip.final <= 6.2,
      '回跳后播放位置仍在 3~6s 区间内',
      'final=' + (clipRun.clip ? clipRun.clip.final : '-'));
    check(clipRun.video && clipRun.video.soften === true,
      '回跳时触发 320ms 柔化（消除片段循环点硬切）',
      JSON.stringify(clipRun.video && clipRun.video.soften));

    console.log('\n[主页导航与头像下拉]');
    const EXPECT_NAV = ['主页', '文章', '影视资源', 'げん的宝库', '碎碎念'];
    const usableNav = home.navItems.filter(function (n) {
      return n.tag === 'A' && n.href && !n.disabled;
    });
    const usableDropdown = home.dropdownLinks.filter(function (n) {
      return n.tag === 'A' && n.href && !n.disabled;
    });
    check(home.navCount === 5, '主导航 5 个导航项', 'count=' + home.navCount);
    check(JSON.stringify(home.navLabels) === JSON.stringify(EXPECT_NAV),
      '导航文案与需求一致', JSON.stringify(home.navLabels));
    check(usableNav.length === 5, '决策 6：5 项导航一次性全部启用为可用链接', JSON.stringify(home.navLabels));
    check(usableNav.every(function (n) { return !n.disabled; }),
      '无 aria-disabled / is-muted 禁用态残留', JSON.stringify(usableNav));
    check(home.dropdownCount === 1, '头像下已生成下拉列表', 'count=' + home.dropdownCount);
    check(home.logoutInDropdown === true && home.logoutTotal === 1,
      '退出登录已收纳进下拉列表',
      'inDropdown=' + home.logoutInDropdown + ' total=' + home.logoutTotal);
    check(usableDropdown.length === 2,
      '决策 6：下拉「个人资料 / 账号设置」同批启用为可用链接',
      JSON.stringify(home.dropdownLinks.map(function (n) { return n.text; })));
    check(home.dropdownLogoutAtBottom === true, '退出登录位于下拉列表最底部');
    check(home.guestActions.exists === true && home.guestActions.visible === true,
      '决策 2：访客态顶栏存在（含登录 / 注册入口）', JSON.stringify(home.guestActions));
    check(home.guestActions.loginHref === 'login.html' &&
      /^login\.html\?tab=register$/.test(home.guestActions.registerHref),
      '访客态登录 / 注册入口均为真实链接', JSON.stringify(home.guestActions));
    check(home.brandName === '炫与梓', '决策 8：主页品牌已统一为「炫与梓」', JSON.stringify(home.brandName));
    check(homeMenu.menu && homeMenu.menu.wasHidden === true,
      '下拉默认收起', JSON.stringify(homeMenu.menu));
    check(homeMenu.menu && homeMenu.menu.opened.hidden === false &&
      homeMenu.menu.opened.expanded === 'true',
      '点击头像展开下拉（aria-expanded 同步）', JSON.stringify(homeMenu.menu && homeMenu.menu.opened));
    check(homeMenu.menu && homeMenu.menu.closed.hidden === true &&
      homeMenu.menu.closed.expanded === 'false',
      '点击外部可收起下拉（aria-expanded 同步）', JSON.stringify(homeMenu.menu && homeMenu.menu.closed));

    console.log('\n[主页]');
    check(home.scrollWidth <= home.viewport[0], '主页无横向溢出', 'scrollWidth=' + home.scrollWidth);
    check(home.faceTotal === 2 && home.faceLoaded === 2,
      '品牌头像与用户头像均加载成功', home.faceLoaded + '/' + home.faceTotal);
    check(home.wallpaperLoaded && home.wallpaperNatural === '1280x720',
      '主页沿用同一张壁纸封面', home.wallpaperNatural);
    check(home.canvasCount >= 1 && home.veilCount === 1, '主页动态光效层与遮罩已挂载');
    check(home.topbar && home.topbar.w <= 1160, '导航栏宽度符合设计约束', JSON.stringify(home.topbar));
    check(home.externalRefs === 0, '主页零外部资源引用', 'count=' + home.externalRefs);
    check(home.sessionBoxHidden === true && home.guestActions.visible === true,
      '主页默认访客态顶栏：登录态用户区隐藏、访客入口可见',
      JSON.stringify([home.sessionBoxHidden, home.guestActions.visible]));
    check(noFoot(home), '主页无关脚标已全部移除', JSON.stringify(home.removed));
    check(home.errors.length === 0, '主页无运行时错误', JSON.stringify(home.errors));

    console.log('\n[首屏诗句与背景完整显示]');
    const POEM_TEXT = '怎叹那青丝以落幕，青山不知我痛苦';
    check(home.poem && home.poem.lineCount === 2, '诗句按逗号分为两行',
      JSON.stringify(home.poem && home.poem.lineCount));
    check(home.poem && home.poem.dataText.join('') === POEM_TEXT,
      '诗句文案逐字一致（data-text 单一数据源）',
      JSON.stringify(home.poem && home.poem.dataText));
    check(home.poem && home.poem.label === POEM_TEXT,
      '无障碍 aria-label 与诗句逐字一致', JSON.stringify(home.poem && home.poem.label));
    check(home.poem && home.poem.charCount === POEM_TEXT.length,
      '逐字生成 ' + POEM_TEXT.length + ' 个字符（用户文本走 textContent）',
      JSON.stringify(home.poem && home.poem.charCount));
    const pd = home.poem ? home.poem.delays : [];
    check(pd.length === POEM_TEXT.length &&
      pd.every(function (v, i, a) { return i === 0 || v > a[i - 1]; }) &&
      pd[pd.length - 1] > 2,
      '逐字 animation-delay 严格递增（确实是「逐个显示」而非一次性）',
      JSON.stringify(pd));
    check(home.video && home.video.fit === 'contain',
      '首页视频 object-fit: contain（16:9 背景完整不裁切）',
      home.video ? home.video.fit : '-');
    check(login.video && login.video.fit === 'cover',
      '登录页仍为 cover（完整显示改动仅限首页）',
      login.video ? login.video.fit : '-');
    check(/blur\(/.test(home.underlayBlur || ''),
      '封面垫底层已模糊放大，填充 contain 留白', home.underlayBlur || '');
    check(home.underlayAnim === 'wall-underlay-drift',
      '垫底层 24s 缓慢漂移已启用', home.underlayAnim || '');
    check(home.veilAnim === 'veil-breathe',
      '遮罩 16s 呼吸动效已启用', home.veilAnim || '');
    check(home.cover && home.cover.h >= 400,
      '首屏封面区占据整屏', JSON.stringify(home.cover));
    check(home.heroTop !== null && home.heroTop >= home.viewport[1] * 0.85,
      '欢迎卡与聚合区下移到第二屏，首屏无卡片遮挡',
      'heroTop=' + home.heroTop + ' viewportH=' + home.viewport[1]);

    console.log('\n[背景音乐]');
    check(home.audio && home.audio.exists === true, '背景音乐元素已接入', JSON.stringify(home.audio));
    check(home.audio && /assets\/bgm\.wav$/.test(home.audio.src || ''),
      '音频源为本地 WAV，零外部依赖', home.audio ? home.audio.src : '');
    check(home.audio && home.audio.loop === true, '背景音乐循环播放', JSON.stringify(home.audio && home.audio.loop));
    check(home.audio && home.audio.btnExists === true, '音频开关按钮已接入（可开/关）', JSON.stringify(home.audio && home.audio.btnExists));
    console.log('  INFO  背景音乐自动播放 paused=' + (home.audio ? home.audio.paused : 'n/a') +
      '（浏览器策略：无声手势自动播放可能被拦，用户点击开关即满足手势）');

    console.log('\n[反向注入]');
    check(broken.faceLoaded === 0, '头像路径失效时探针确实报错（证明验收非空壳）',
      'loaded=' + broken.faceLoaded);
    check(broken.wallpaperLoaded === true, '反向注入未误伤壁纸封面加载');
    check(noVideo.videoCount === 0 && noVideo.video === null,
      '切回静态模式时探针确实检出「无视频」（证明视频验收非空壳）',
      'count=' + noVideo.videoCount);
    check(home.menu && home.menu.opened.hidden === true,
      '移除 site.js 顶栏交互层后点击头像不会展开（证明下拉交互验收非空壳）',
      JSON.stringify(home.menu && home.menu.opened));
    check(badClip.clip && (badClip.clip.start !== 3 || badClip.clip.end !== 6),
      '篡改区间标记时探针确实检出「不再是 3~6s」（证明区间验收非空壳）',
      JSON.stringify(badClip.clip && [badClip.clip.start, badClip.clip.end]));
    // ---- P1 新增反向注入：证明「导航 / 下拉 / 访客态」断言不是永远通过 ----
    const navUsableCount = navBroken.navItems.filter(function (n) {
      return n.tag === 'A' && n.href && !n.disabled;
    }).length;
    check(navUsableCount < 5,
      '导航改回禁用态时探针确实检出可用链接不足 5（证明导航验收非空壳）',
      'usable=' + navUsableCount);
    const ddUsableCount = dropdownBroken.dropdownLinks.filter(function (n) {
      return n.tag === 'A' && n.href && !n.disabled;
    }).length;
    check(ddUsableCount < 2,
      '下拉项改回禁用态时探针确实检出（证明下拉验收非空壳）', 'usable=' + ddUsableCount);
    check(guestBroken.guestActions.exists === false,
      '删除访客态顶栏时探针确实检出缺失（证明访客态验收非空壳）',
      JSON.stringify(guestBroken.guestActions));
    // 正向：访客 stub 驱动真实脚本后，登录态下拉区不应出现
    check(guestRun.guestActions.visible === true && guestRun.sessionBoxHidden === true,
      '访客 stub 驱动下仍保持访客态、登录态下拉不出现',
      JSON.stringify([guestRun.guestActions.visible, guestRun.sessionBoxHidden]));
    check(guestRun.errors.length === 0, '访客态副本运行无异常', JSON.stringify(guestRun.errors));
    // ---- 首屏诗句 / 背景完整显示反向注入 ----
    check(poemBroken.poem && poemBroken.poem.charCount === 0,
      '移除 poem.js 后探针检出「无逐字字符」（证明逐字验收非空壳）',
      JSON.stringify(poemBroken.poem && poemBroken.poem.charCount));
    check(poemBroken.poem && poemBroken.poem.dataText.join('') === POEM_TEXT,
      '反向副本文案仍在，探针能区分「文案存在」与「逐字渲染」',
      JSON.stringify(poemBroken.poem && poemBroken.poem.dataText));
    check(poemBroken.video && poemBroken.video.fit === 'cover',
      '强制改回 cover 时探针检出「不再完整显示」（证明背景验收非空壳）',
      poemBroken.video ? poemBroken.video.fit : '-');

    console.log('\n[视觉预览]');
    [shots.login, shots.home, shots.homeMenu, shots.homeGuest].forEach(function (p) {
      check(fs.existsSync(p) && fs.statSync(p).size > 5000,
        '已生成 ' + path.basename(p), fs.existsSync(p) ? fs.statSync(p).size + ' bytes' : 'missing');
    });

    console.log('\n==================================================');
    console.log('结果: 通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
    if (failures.length > 0) process.exit(1);
    console.log('结论: UI 改版验收通过');
  } finally {
    // 清理失败不得让「断言全绿」误报为失败（safe-delete 守卫可能拒绝 unlink）。
    tempFiles.forEach(function (n) {
      const p = path.join(WEB, n);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); }
      catch (e) { /* 由下面的目录枚举统一告警 */ }
    });
    // Windows delete-pending 下 existsSync 会误报已删除，用 readdirSync 枚举复核。
    const still = fs.readdirSync(WEB).filter(function (n) {
      return /^_ui_.*\.html$/.test(n);
    });
    if (still.length) {
      console.warn('警告: 以下临时副本未能清理，请手动删除 -> ' + still.join(', '));
    }
  }
}

try {
  main();
} catch (err) {
  console.error('UI 验收执行异常:', err);
  process.exit(1);
}
