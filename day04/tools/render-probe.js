'use strict';

/**
 * 真实浏览器渲染复核（Chrome / Edge headless + DOM 探针）。
 *
 * 结构自检只能证明「HTML 合法」，不能证明「排版正确、脚本真的跑起来」。
 * 本脚本把探针注入登录页的临时副本，用 --dump-dom 读回权威渲染数据：
 *   - 登录卡片是否水平居中、有无横向溢出
 *   - Canvas 背景是否真的挂载并分配到像素
 *   - 5 种动态背景分支是否都能挂载；资源缺失时是否回退到 Canvas
 *   - P1 扩展：8 个非登录页（主页 + 7 个页面壳）逐一复核背景层实际像素、
 *     统一顶栏、5 项导航、三态齐备、访客态顶栏、零外链与运行时异常
 *
 * 用法: node tools/render-probe.js
 * 未安装 Chrome/Edge 时输出 SKIP 并以 0 退出（如实说明未做渲染复核）。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const PROBE_FILE = path.join(WEB_DIR, '_render_probe.html');

const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findBrowser() {
  return BROWSER_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

const PROBE_SCRIPT = [
  '<script>',
  '(function () {',
  '  var results = {};',
  '  function finish() {',
  '    var card = document.querySelector(".auth-card");',
  '    var canvas = document.querySelector(".bg-canvas");',
  '    var rect = card ? card.getBoundingClientRect() : null;',
  '    results.layout = {',
  '      innerWidth: window.innerWidth,',
  '      innerHeight: window.innerHeight,',
  '      cardWidth: rect ? Math.round(rect.width) : 0,',
  '      cardHeight: rect ? Math.round(rect.height) : 0,',
  '      centerOffsetX: rect ? Math.round(rect.left + rect.width / 2 - window.innerWidth / 2) : 9999,',
  '      scrollWidth: document.documentElement.scrollWidth,',
  '      canvasCount: document.querySelectorAll(".bg-canvas").length,',
  '      canvasPixelWidth: canvas ? canvas.width : 0,',
  '      canvasPixelHeight: canvas ? canvas.height : 0,',
  '      formCount: document.querySelectorAll("form").length,',
  '      tabCount: document.querySelectorAll(".tab").length,',
  '      loginFormVisible: !document.getElementById("form-login").hidden,',
  '      registerFormHidden: document.getElementById("form-register").hidden',
  '    };',
  '    var types = ["canvas", "slideshow", "image", "gif", "video"];',
  '    var layers = {};',
  '    results.backgrounds = {};',
  '    types.forEach(function (type) {',
  '      var layer = document.createElement("div");',
  '      layer.className = "bg-layer";',
  '      layer.style.position = "fixed";',
  '      layer.style.left = "-10000px";',
  '      layer.style.top = "0";',
  '      layer.style.width = "400px";',
  '      layer.style.height = "300px";',
  '      document.body.appendChild(layer);',
  '      layers[type] = layer;',
  '      var cfg = {',
  '        type: type,',
  '        canvas: { dotCount: 4 },',
  '        slideshow: { images: null, intervalMs: 999999, fadeMs: 100 },',
  '        media: { src: "assets/__not_exist__.gif", poster: "" }',
  '      };',
  '      try {',
  '        window.BlogBackground.mount(layer, cfg);',
  '        results.backgrounds[type] = { mounted: true };',
  '      } catch (err) {',
  '        results.backgrounds[type] = { mounted: false, error: String(err) };',
  '      }',
  '    });',
  '    setTimeout(function () {',
  '      Object.keys(layers).forEach(function (type) {',
  '        var layer = layers[type];',
  '        var item = results.backgrounds[type];',
  '        item.canvas = layer.querySelectorAll(".bg-canvas").length;',
  '        item.slides = layer.querySelectorAll(".bg-slide").length;',
  '        item.media = layer.querySelectorAll(".bg-media").length;',
  '        item.veil = layer.querySelectorAll(".bg-veil").length;',
  '        item.activeSlides = layer.querySelectorAll(".bg-slide.is-active").length;',
  '        if (layer.parentNode) layer.parentNode.removeChild(layer);',
  '      });',
  '      var out = document.createElement("div");',
  '      out.id = "probe-result";',
  '      out.textContent = "PROBE_JSON " + JSON.stringify(results);',
  '      document.body.appendChild(out);',
  '    }, 1400);',
  '  }',
  '  if (document.readyState === "complete") setTimeout(finish, 200);',
  '  else window.addEventListener("load", function () { setTimeout(finish, 200); });',
  '})();',
  '</script>',
].join('\n');

/* ============================================================
   P1 扩展（§7）：背景层断言（.bg-canvas 实际像素）对所有新页同样适用。
   8 个非登录页逐一用访客 stub + 轻量探针复核：背景层、遮罩、顶栏、
   5 项导航、零外链、无横向溢出、三态齐备、访客态顶栏、运行时无异常。
   ============================================================ */
const PAGE_FILES = [
  'home.html', 'articles.html', 'media.html', 'vault.html',
  'moments.html', 'profile.html', 'settings.html', 'share.html',
];

/** 守卫替换为访客 stub：避免 file:// 下发起真实 API 请求或跳转登录页。 */
const PAGE_STUB = [
  '<script>',
  '(function () {',
  '  document.body.classList.remove("guard-pending");',
  '  window.BlogGuard = {',
  '    optionalLogin: function () { return Promise.resolve({ guest: true, user: null, session: null }); },',
  '    requireLogin: function () { return Promise.resolve(null); }',
  '  };',
  '  if (window.BlogApi) {',
  '    window.BlogApi.siteConfig = function () { return Promise.reject(new Error("probe-stub")); };',
  '  }',
  '})();',
  '</script>',
].join('\n');

const PAGE_PROBE_SCRIPT = [
  '<script>',
  '(function () {',
  '  var errors = [];',
  '  window.addEventListener("error", function (e) { errors.push(String(e.message || e)); });',
  '  function finish() {',
  '    var canvas = document.querySelector(".bg-canvas");',
  '    var refs = [].slice.call(document.querySelectorAll("[src],[href]"))',
  '      .map(function (el) { return el.getAttribute("src") || el.getAttribute("href") || ""; });',
  '    var d = {',
  '      page: document.body.getAttribute("data-page"),',
  '      title: document.title,',
  '      canvasCount: document.querySelectorAll(".bg-canvas").length,',
  '      canvasPixels: canvas ? canvas.width + "x" + canvas.height : "none",',
  '      veilCount: document.querySelectorAll(".bg-veil").length,',
  '      topbar: !!document.querySelector(".topbar"),',
  '      navCount: document.querySelectorAll(".nav-link").length,',
  '      triad: [!!document.getElementById("state-loading"), !!document.getElementById("state-empty"), !!document.getElementById("state-error")],',
  '      guestVisible: (function () { var g = document.getElementById("user-guest"); return !!g && !g.hidden; })(),',
  '      sessionHidden: (function () { var s = document.getElementById("user-session"); return !!s && s.hidden; })(),',
  '      externalRefs: refs.filter(function (v) { return /^https?:/i.test(v); }).length,',
  '      scrollWidth: document.documentElement.scrollWidth,',
  '      innerWidth: window.innerWidth,',
  '      errors: errors',
  '    };',
  '    var out = document.createElement("div");',
  '    out.id = "page-probe-result";',
  '    out.textContent = "PROBE_JSON " + JSON.stringify(d);',
  '    document.body.appendChild(out);',
  '  }',
  '  if (document.readyState === "complete") setTimeout(finish, 200);',
  '  else window.addEventListener("load", function () { setTimeout(finish, 200); });',
  '})();',
  '</script>',
].join('\n');

function dumpDom(browser, htmlFile, budget) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-chrome-'));
  const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,900', '--force-device-scale-factor=1',
    '--virtual-time-budget=' + (budget || 6000),
    '--user-data-dir=' + userDataDir, '--dump-dom', fileUrl,
  ];
  try {
    return String(cp.execFileSync(browser, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      timeout: 90000,
    }));
  } finally {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  }
}

function parseProbe(dom, label) {
  const matched = /PROBE_JSON\s+(\{.*?\})<\/div>/s.exec(dom);
  if (!matched) {
    console.error('FAIL: 未从 --dump-dom 输出中读到探针结果 (' + label + ')');
    console.error(dom.slice(-1200));
    process.exit(1);
  }
  try {
    return JSON.parse(matched[1]);
  } catch (err) {
    console.error('FAIL: 探针 JSON 解析失败 (' + label + '):', err.message);
    console.error(matched[1].slice(0, 800));
    process.exit(1);
  }
}

function main() {
  const browser = findBrowser();
  if (!browser) {
    console.log('SKIP: 未找到 Chrome / Edge，跳过真实浏览器渲染复核。');
    console.log('      结构自检与端到端 API 测试仍然有效，但排版未经浏览器实测。');
    process.exit(0);
  }

  const original = fs.readFileSync(path.join(WEB_DIR, 'login.html'), 'utf8');
  const injected = original.replace('</body>', PROBE_SCRIPT + '\n</body>');
  if (injected === original) throw new Error('注入探针失败：未找到 </body>');

  const tempFiles = [PROBE_FILE];
  const pageResults = [];
  let data;

  try {
    fs.writeFileSync(PROBE_FILE, injected, 'utf8');
    data = parseProbe(dumpDom(browser, PROBE_FILE, 6000), 'login.html');

    // P1：8 个非登录页逐一复核；守卫替换为访客 stub，避免真实网络请求与跳转。
    PAGE_FILES.forEach(function (name) {
      const src = fs.readFileSync(path.join(WEB_DIR, name), 'utf8');
      const stubbed = src.replace('<script src="js/auth-guard.js"></script>', PAGE_STUB);
      if (stubbed === src) throw new Error('注入守卫 stub 失败: ' + name);
      const pageHtml = stubbed.replace('</body>', PAGE_PROBE_SCRIPT + '\n</body>');
      const tmp = path.join(WEB_DIR, '_render_' + name);
      fs.writeFileSync(tmp, pageHtml, 'utf8');
      tempFiles.push(tmp);
      pageResults.push({ name: name, data: parseProbe(dumpDom(browser, tmp, 3000), name) });
    });
  } finally {
    tempFiles.forEach(function (p) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  }

  const failures = [];
  let passed = 0;
  function check(condition, label, extra) {
    if (condition) {
      passed += 1;
      console.log('  PASS  ' + label);
    } else {
      failures.push(label + (extra ? ' | ' + extra : ''));
      console.log('  FAIL  ' + label + (extra ? ' | ' + extra : ''));
    }
  }

  const L = data.layout;
  const B = data.backgrounds;
  console.log('================ 真实浏览器渲染复核 ================');
  console.log('浏览器: ' + path.basename(browser));
  console.log('视口: ' + L.innerWidth + 'x' + L.innerHeight +
    ' | 卡片: ' + L.cardWidth + 'x' + L.cardHeight +
    ' | 水平中心偏移: ' + L.centerOffsetX + 'px');
  console.log('');

  check(Math.abs(L.centerOffsetX) <= 2, '登录卡片水平居中', 'offset=' + L.centerOffsetX);
  check(L.scrollWidth <= L.innerWidth, '页面无横向溢出', 'scrollWidth=' + L.scrollWidth);
  check(L.cardWidth > 300 && L.cardWidth <= 424, '卡片宽度符合设计约束 (<=424px)', 'w=' + L.cardWidth);
  check(L.canvasCount >= 1 && L.canvasPixelWidth > 0 && L.canvasPixelHeight > 0,
    'Canvas 动态背景已挂载且分配到实际像素',
    'count=' + L.canvasCount + ' px=' + L.canvasPixelWidth + 'x' + L.canvasPixelHeight);
  check(L.formCount === 2, '登录/注册两个表单均存在', 'count=' + L.formCount);
  check(L.tabCount === 2, '登录/注册两个 Tab 均存在', 'count=' + L.tabCount);
  check(L.loginFormVisible === true && L.registerFormHidden === true,
    '默认展示登录表单、隐藏注册表单');

  check(B.canvas.mounted && B.canvas.canvas >= 1 && B.canvas.veil === 1,
    '背景分支 canvas 正常', JSON.stringify(B.canvas));
  check(B.slideshow.mounted && B.slideshow.slides >= 1 && B.slideshow.activeSlides >= 1,
    '背景分支 slideshow 生成并激活内置渐变图', JSON.stringify(B.slideshow));

  ['image', 'gif', 'video'].forEach(function (type) {
    check(
      B[type].mounted && B[type].canvas >= 1 && B[type].veil === 1,
      '背景分支 ' + type + ' 资源缺失时自动回退到 Canvas（不白屏）',
      JSON.stringify(B[type])
    );
  });

  console.log('\n[P1 全量页面壳：背景层 / 顶栏 / 三态 / 访客态]');
  pageResults.forEach(function (item) {
    const p = item.data;
    const px = /^(\d+)x(\d+)$/.exec(p.canvasPixels);
    check(p.canvasCount >= 1 && !!px && Number(px[1]) > 0 && Number(px[2]) > 0,
      item.name + ' 的 .bg-canvas 已挂载且分配到实际像素', p.canvasPixels);
    check(p.veilCount >= 1, item.name + ' 的暖调遮罩层已挂载', 'veil=' + p.veilCount);
    check(p.topbar === true && p.navCount === 5,
      item.name + ' 复用统一顶栏且 5 项导航齐备',
      'topbar=' + p.topbar + ' nav=' + p.navCount);
    check(p.externalRefs === 0, item.name + ' 零外部资源引用', 'count=' + p.externalRefs);
    check(p.scrollWidth <= p.innerWidth, item.name + ' 无横向溢出',
      'scrollWidth=' + p.scrollWidth + ' innerWidth=' + p.innerWidth);
    if (item.name === 'home.html') {
      check(p.guestVisible === true && p.sessionHidden === true,
        item.name + ' 访客态顶栏生效（登录态下拉隐藏）',
        JSON.stringify([p.guestVisible, p.sessionHidden]));
    } else {
      check(p.triad[0] && p.triad[1] && p.triad[2],
        item.name + ' 加载/空/错误三态齐备', JSON.stringify(p.triad));
      check(p.guestVisible === true && p.sessionHidden === true,
        item.name + ' 访客态顶栏生效（登录态下拉隐藏）',
        JSON.stringify([p.guestVisible, p.sessionHidden]));
    }
    check(p.errors.length === 0, item.name + ' 无运行时错误', JSON.stringify(p.errors));
  });

  console.log('\n==================================================');
  console.log('结果: 通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
  if (failures.length > 0) {
    failures.forEach(function (item) { console.log('  - ' + item); });
    console.log('结论: 渲染复核未通过');
    process.exit(1);
  }
  console.log('结论: 渲染复核通过');
}

try {
  main();
} catch (err) {
  if (fs.existsSync(PROBE_FILE)) fs.unlinkSync(PROBE_FILE);
  console.error('渲染复核执行异常:', err);
  process.exit(1);
}
