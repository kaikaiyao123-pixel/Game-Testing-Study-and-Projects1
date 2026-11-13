'use strict';
/**
 * P3 前端 UI 验收（无凭据静态契约 + 真实浏览器渲染冒烟）。
 *
 * 覆盖 P3 新增/改造的四个业务页面（影视 media / 宝库 vault / 碎碎念 moments /
 * 账号设置 settings）与分享只读页 share：
 *   1) 静态契约：页面引用专属脚本、#content-root 位于 .shell-card 内、脚本定义
 *      window.BlogPage.init（页面壳委派契约）、脚本语法可加载、页面零外链。
 *   2) 真实浏览器冒烟（headless Chrome + 访客 stub，与 render-probe 同机制）：
 *      页面可加载、无运行时异常、统一顶栏、5 项导航、零外链、委派契约已绑定。
 *   3) 三类反向注入：零外部资源 / content-root 在卡片内 / 用户文本经 textContent
 *      而非 innerHTML 渲染（脚本标签不会被当作 HTML 执行）。
 *
 * 用法: node tools/verify-p3-ui.js
 * 未安装 Chrome/Edge 时跳过浏览器冒烟，仅做静态契约校验。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');

const P3_PAGES = [
  { html: 'media.html', script: 'js/media.js', name: '影视资源' },
  { html: 'vault.html', script: 'js/vault.js', name: '宝库' },
  { html: 'moments.html', script: 'js/moments.js', name: '碎碎念' },
  { html: 'settings.html', script: 'js/settings.js', name: '账号设置' },
  { html: 'share.html', script: 'js/share.js', name: '分享只读页' },
];

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

// 访客 stub：把 auth-guard 替换为不发起真实请求、不跳转登录页的桩，
// 使非登录页也能在浏览器里跑起来做结构冒烟（与 render-probe 同源做法）。
const PAGE_STUB = [
  '<script>',
  '(function () {',
  '  document.body.classList.remove("guard-pending");',
  '  window.BlogGuard = {',
  '    optionalLogin: function () { return Promise.resolve({ guest: true, user: null, session: null }); },',
  '    requireLogin: function () { return Promise.resolve(null); }',
  '  };',
  '  if (window.BlogApi) { window.BlogApi.siteConfig = function () { return Promise.reject(new Error("probe-stub")); }; }',
  '})();',
  '</script>',
].join('\n');

const PAGE_PROBE = [
  '<script>',
  '(function () {',
  '  var errors = [];',
  '  window.addEventListener("error", function (e) { errors.push(String(e.message || e)); });',
  '  function finish() {',
  '    var refs = [].slice.call(document.querySelectorAll("[src],[href]"))',
  '      .map(function (el) { return el.getAttribute("src") || el.getAttribute("href") || ""; });',
  '    var root = document.getElementById("content-root");',
  '    var shellCard = (root && root.closest(".shell-card")) || null;',
  '    var d = {',
  '      page: document.body.getAttribute("data-page"),',
  '      topbar: !!document.querySelector(".topbar"),',
  '      navCount: document.querySelectorAll(".nav-link").length,',
  '      externalRefs: refs.filter(function (v) { return /^https?:/i.test(v); }).length,',
  '      hasContentRoot: !!root,',
  '      rootInShellCard: !!shellCard,',
  '      blogPageInit: (function () { return typeof window.BlogPage !== "undefined" && typeof window.BlogPage.init === "function"; })(),',
  '      errors: errors',
  '    };',
  '    var out = document.createElement("div");',
  '    out.id = "p3-probe-result";',
  '    out.textContent = "P3_PROBE_JSON " + JSON.stringify(d);',
  '    document.body.appendChild(out);',
  '  }',
  '  if (document.readyState === "complete") setTimeout(finish, 250);',
  '  else window.addEventListener("load", function () { setTimeout(finish, 250); });',
  '})();',
  '</script>',
].join('\n');

function dumpDom(browser, htmlFile) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-chrome-'));
  const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,900', '--force-device-scale-factor=1',
    '--virtual-time-budget=3000',
    '--user-data-dir=' + userDataDir, '--dump-dom', fileUrl,
  ];
  try {
    return String(cp.execFileSync(browser, args, {
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 90000,
    }));
  } finally {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

function parseProbe(dom, label) {
  const m = /P3_PROBE_JSON\s+(\{.*?\})<\/div>/s.exec(dom);
  if (!m) throw new Error('未读到探针结果 (' + label + ')');
  return JSON.parse(m[1]);
}

let pass = 0, fail = 0;
const failures = [];
function check(ok, label, extra) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (extra ? ' | ' + extra : '')); console.log('  FAIL  ' + label + (extra ? ' | ' + extra : '')); }
}

console.log('================ P3 前端 UI 验收 ================');

// ---------- 1) 静态契约（无凭据） ----------
console.log('· 静态契约校验');
P3_PAGES.forEach((p) => {
  const htmlPath = path.join(WEB_DIR, p.html);
  const jsPath = path.join(WEB_DIR, p.script);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');

  check(html.includes(p.script), p.name + ' 页面加载专属脚本 ' + p.script);
  check(/id="content-root"/.test(html), p.name + ' 含 #content-root');
  // 反向注入 2：content-root 必须位于 .shell-card 内（布局契约）
  // shell-card 可能是多类名之一，按类令牌匹配其在文档中的位置
  const rootIdx = html.indexOf('id="content-root"');
  const cardMatch = html.match(/class="[^"]*shell-card/);
  const cardIdx = cardMatch ? cardMatch.index : -1;
  check(cardIdx !== -1 && rootIdx > cardIdx, p.name + ' #content-root 位于 .shell-card 内');
  // 委派契约：脚本定义 window.BlogPage.init
  check(/window\.BlogPage\s*=\s*\{[^]*?init\s*:/.test(js) || /window\.BlogPage\s*=\s*\{/.test(js) && /init\s*:\s*function/.test(js), p.name + ' 脚本定义 window.BlogPage.init（页面壳委派）');
  // 脚本语法可加载
  try {
    cp.execFileSync(process.execPath, ['--check', jsPath], { stdio: 'ignore' });
    check(true, p.name + ' 脚本语法有效 (node --check)');
  } catch (e) { check(false, p.name + ' 脚本语法有效 (node --check)', String(e.message || e).split('\n')[0]); }
  // 反向注入 1：页面零外链
  const ext = (html.match(/(src|href)\s*=\s*"https?:\/\/[^"]+/gi) || []);
  check(ext.length === 0, p.name + ' 页面零外部资源引用', 'found=' + ext.length);
  // 反向注入 3：用户文本走 textContent，innerHTML 仅允许「清空容器('')」或
  // 「服务端已净化的 contentHtml」——其余把用户字段直接塞进 innerHTML 视为误用
  const usesTextContent = /textContent\s*=/.test(js);
  const innerAssignments = js.match(/innerHTML\s*=\s*[^;]+/g) || [];
  const badInner = innerAssignments.filter((a) => {
    const rhs = a.replace(/innerHTML\s*=\s*/, '').trim();
    if (rhs === "''" || rhs === '""') return false; // 清空容器，安全
    if (/contentHtml|sanitiz|safeHtml/.test(rhs)) return false; // 服务端已净化
    return /(title|note|name|text|body|src|url|content|value)\b/.test(rhs);
  });
  check(usesTextContent && badInner.length === 0, p.name + ' 用户文本经 textContent 渲染（不执行注入 HTML）', badInner.length ? badInner.join('|').slice(0, 80) : '');
});

// ---------- 2) 真实浏览器冒烟 ----------
console.log('· 浏览器渲染冒烟');
const browser = findBrowser();
if (!browser) {
  console.log('  SKIP  未找到 Chrome/Edge，跳过浏览器冒烟（静态契约已覆盖关键不变量）。');
} else {
  const tempFiles = [];
  try {
    P3_PAGES.forEach((p) => {
      const src = fs.readFileSync(path.join(WEB_DIR, p.html), 'utf8');
      const stubbed = src.replace('<script src="js/auth-guard.js"></script>', PAGE_STUB);
      if (stubbed === src) { check(false, p.name + ' 注入守卫 stub 失败'); return; }
      const pageHtml = stubbed.replace('</body>', PAGE_PROBE + '\n</body>');
      const tmp = path.join(WEB_DIR, '_p3ui_' + p.html);
      fs.writeFileSync(tmp, pageHtml, 'utf8');
      tempFiles.push(tmp);
      const dom = dumpDom(browser, tmp);
      const d = parseProbe(dom, p.html);
      check(d.topbar === true && d.navCount === 5, p.name + ' 统一顶栏 + 5 项导航', 'nav=' + d.navCount);
      check(d.externalRefs === 0, p.name + ' 浏览器内零外链', 'count=' + d.externalRefs);
      check(d.errors.length === 0, p.name + ' 运行时无异常', (d.errors || []).join('; ').slice(0, 120));
      check(d.blogPageInit === true, p.name + ' 页面壳委派契约已绑定 (window.BlogPage.init)');
      check(d.hasContentRoot === true && d.rootInShellCard === true, p.name + ' content-root 在卡片内');
    });
  } finally {
    tempFiles.forEach((t) => { if (fs.existsSync(t)) fs.unlinkSync(t); });
  }
}

console.log('\n===== P3 UI 验收结果 =====');
console.log('通过 ' + pass + ' · 失败 ' + fail);
if (failures.length) { console.log('失败项:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail === 0 ? 0 : 1);
