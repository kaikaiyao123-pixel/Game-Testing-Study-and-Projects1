'use strict';

/**
 * 交付物程序化自检（无需浏览器）。
 *
 * 用法：
 *   node tools/selfcheck.js                 # 全量自检 + 反向注入测试
 *   node tools/selfcheck.js <项目根目录>    # 指定根目录
 *   node tools/selfcheck.js --file <html>  # 单文件检查（供反向注入子进程调用）
 *
 * P1 扩展：遍历 web/ 下全部交付页面（2 个既有页 + 7 个页面壳），新增
 * 页面壳必填清单、品牌一致性与禁用态残留检查、web/vendor/ 零外链扫描。
 * 反向注入测试会故意制造 6 类已知缺陷，并以子进程方式调用本脚本的
 * --file 模式，断言退出码为 1，证明自检不是「永远通过」的空壳。
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** P1 同批交付的 7 个页面壳（§7）。骨架由 gen-shell-pages.js 统一生成。 */
const SHELL_PAGES = [
  'articles.html', 'media.html', 'vault.html', 'moments.html',
  'profile.html', 'settings.html', 'share.html',
];
const SHELL_SET = new Set(SHELL_PAGES);
const ALL_PAGES = ['login.html', 'home.html'].concat(SHELL_PAGES);

/** 关键内容存在性：校验串不含 < >，避免被 HTML 转义干扰 */
const REQUIRED = {
  'login.html': [
    'form-login', 'form-register', 'btn-login', 'btn-register',
    'bg-layer', 'js/api.js', 'js/background.js',
    'audio-toggle', 'bg-audio', 'js/audio.js', 'assets/bgm.wav',
    '炫与梓', // 决策 8：品牌统一
  ],
  'home.html': [
    'main-nav', 'btn-logout', 'user-name', 'user-menu-btn', 'user-dropdown',
    'user-guest', 'user-session', 'js/auth-guard.js', 'js/site.js', 'js/home.js',
    'js/poem.js', 'home-poem', '怎叹那青丝以落幕，青山不知我痛苦',
    'audio-toggle', 'bg-audio', 'js/audio.js', 'assets/bgm.wav',
    '炫与梓',
  ],
  'shell': [
    // 顶栏统一骨架（site.js 会逐页校验这些 id）
    'main-nav', 'bg-layer', 'user-guest', 'user-session', 'user-menu-btn',
    'user-dropdown', 'btn-logout', 'nav-toggle',
    // 三态齐备（P8′ 硬要求）
    'state-loading', 'state-empty', 'state-error',
    'shell-title', 'shell-desc', 'shell-empty-hint', 'shell-create',
    'shell-guest-hint', 'shell-notice', 'shell-error-text', 'shell-retry',
    'js/auth-guard.js', 'js/site.js', 'js/page-shell.js', 'js/background.js',
    '炫与梓',
  ],
};

/** 禁止内容：品牌回退、禁用态导航/下拉残留（决策 6 / 8）。 */
const FORBIDDEN = {
  'login.html': ['我的博客'],
  'home.html': ['我的博客', 'aria-disabled'],
  'shell': ['我的博客', 'aria-disabled'],
};

function profileOf(file) {
  const base = path.basename(file).toLowerCase();
  if (base === 'login.html' || base.startsWith('_probe')) return 'login.html';
  if (base === 'home.html') return 'home.html';
  if (SHELL_SET.has(base)) return 'shell';
  return null;
}

function collectIds(html) {
  const ids = new Set();
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  return ids;
}

function collectRefs(html) {
  const refs = [];
  const re = /\b(?:src|href|poster)\s*=\s*(["'])([^"']*)\1/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[2]);
  return refs;
}

function isExternal(value) {
  return /^(https?:)?\/\//i.test(value);
}

/** 1. 标签配对：栈式检查，检出未闭合与交叉闭合 */
function checkTags(html) {
  const errors = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    if (VOID_TAGS.has(tag)) continue;
    if (attrs.trim().endsWith('/')) continue;

    if (!closing) {
      stack.push(tag);
    } else if (stack.length === 0) {
      errors.push(`多余的闭合标签 </${tag}>`);
    } else {
      const top = stack[stack.length - 1];
      if (top === tag) stack.pop();
      else errors.push(`标签交叉：期望 </${top}>，实际 </${tag}>`);
    }
  }
  if (stack.length > 0) errors.push(`未闭合标签: ${stack.join(', ')}`);
  return errors;
}

/** 2. 外部资源引用 + 3. 本地资源存在性 */
function checkAttributes(html, dir) {
  const errors = [];
  collectRefs(html).forEach((value) => {
    if (isExternal(value)) {
      errors.push(`引用外部资源（破坏离线自包含）: ${value}`);
      return;
    }
    if (!value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('mailto:')) return;
    const clean = value.split(/[?#]/)[0];
    if (!clean) return;
    const target = path.resolve(dir, clean);
    if (!fs.existsSync(target)) errors.push(`引用的本地资源不存在: ${value}`);
  });
  return errors;
}

/** 4. 目录锚点：href="#x" 必须有对应 id="x"（href="#" 不算） */
function checkAnchors(html) {
  const errors = [];
  const ids = collectIds(html);
  const re = /href="#([A-Za-z0-9_-]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!ids.has(m[1])) errors.push(`锚点无对应 id: #${m[1]}`);
  }
  return errors;
}

/** 5. 关键内容存在性 */
function checkRequired(html, profile) {
  const errors = [];
  if (!profile || !REQUIRED[profile]) return errors;
  REQUIRED[profile].forEach((needle) => {
    if (!html.includes(needle)) errors.push(`缺少关键内容: ${needle}`);
  });
  return errors;
}

/** 5b. 禁止内容：品牌漂移与「即将开放」禁用态残留 */
function checkForbidden(html, profile) {
  const errors = [];
  if (!profile || !FORBIDDEN[profile]) return errors;
  FORBIDDEN[profile].forEach((needle) => {
    if (html.includes(needle)) errors.push(`出现禁止内容: ${needle}`);
  });
  return errors;
}

/** 5c. <title> 必须带统一品牌后缀 */
function checkTitle(html) {
  const m = /<title>([^<]*)<\/title>/i.exec(html);
  if (!m) return ['缺少 <title>'];
  return m[1].includes('炫与梓') ? [] : ['<title> 未使用统一品牌「炫与梓」: ' + m[1]];
}

/** 6. JS 中的 DOM id 引用必须能在 HTML 中找到 */
function checkDomRefs(html, dir) {
  const errors = [];
  const ids = collectIds(html);
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
  let m;
  const jsFiles = [];
  while ((m = scriptRe.exec(html))) {
    if (!isExternal(m[2])) jsFiles.push(path.resolve(dir, m[2]));
  }

  const patterns = [
    /\bgetElementById\(\s*(['"])([^'"]+)\1\s*\)/g,
    /\$\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];

  jsFiles.forEach((jsFile) => {
    if (!fs.existsSync(jsFile)) return; // 已由 checkAttributes 报告
    const source = fs.readFileSync(jsFile, 'utf8');
    patterns.forEach((pattern) => {
      let hit;
      while ((hit = pattern.exec(source))) {
        if (!ids.has(hit[2])) {
          errors.push(`JS 引用了不存在的 DOM id: ${hit[2]} (${path.basename(jsFile)})`);
        }
      }
    });
  });
  return errors;
}

function checkHtmlFile(file, options) {
  const opts = options || {};
  const errors = [];
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const profile = opts.profile || profileOf(file);

  errors.push(...checkTags(html));
  errors.push(...checkAttributes(html, dir));
  errors.push(...checkAnchors(html));
  errors.push(...checkRequired(html, profile));
  errors.push(...checkForbidden(html, profile));
  errors.push(...checkTitle(html));
  errors.push(...checkDomRefs(html, dir));
  return errors;
}

/** CSS 中的 url() 不得引用外部资源 */
function checkCss(file) {
  const errors = [];
  const text = fs.readFileSync(file, 'utf8');
  const re = /url\(\s*(?:(["'])([^"']*)\1|([^)'"\s]+))\s*\)/gi;
  let m;
  while ((m = re.exec(text))) {
    const value = m[2] !== undefined ? m[2] : m[3];
    if (isExternal(value)) errors.push(`CSS 引用外部资源: ${value}`);
  }
  return errors;
}

/**
 * 决策 4：第三方库资源必须完整本地化到 web/vendor/。
 * P1 尚未引入 vendor（目录可不存在），P2 引入后本检查自动生效。
 * 扫描范围内所有文件的 src / href / url() / @import 外部引用。
 */
function checkVendor(root) {
  const errors = [];
  const dir = path.join(root, 'web', 'vendor');
  if (!fs.existsSync(dir)) return errors;

  const re = /(?:\bsrc|\bhref)\s*=\s*(["'])([^"']*)\1|url\(\s*(?:(["'])([^"']*)\3|([^)'"\s]+))\s*\)/gi;
  const walk = (current) => {
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); return; }
      const text = fs.readFileSync(full, 'utf8');
      let m;
      while ((m = re.exec(text))) {
        const value = m[2] !== undefined ? m[2] : (m[4] !== undefined ? m[4] : m[5]);
        if (value && isExternal(value)) {
          errors.push(`vendor 引用外部资源: ${path.relative(root, full)} -> ${value}`);
        }
      }
      re.lastIndex = 0;
    });
  };
  walk(dir);
  return errors;
}

function listFiles(dir, ext) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full, ext));
    else if (entry.name.endsWith(ext)) result.push(full);
  });
  return result;
}

function checkJsSyntax(files, root) {
  const errors = [];
  files.forEach((file) => {
    try {
      cp.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      const detail = String(err.stderr || err.message).trim().split('\n')[0];
      errors.push(`JS 语法错误 ${path.relative(root, file)}: ${detail}`);
    }
  });
  return errors;
}

function runAll(root) {
  const errors = [];
  const webDir = path.join(root, 'web');

  // 遍历 web/ 下所有交付页面（排除 _ 前缀的探针临时副本）。
  // 决策 6 要求 7 个页面壳同批交付，缺一即失败。
  const htmlFiles = (fs.existsSync(webDir)
    ? fs.readdirSync(webDir).filter((n) => n.endsWith('.html') && !n.startsWith('_'))
    : []).sort();

  ALL_PAGES.forEach((name) => {
    if (!htmlFiles.includes(name)) errors.push(`缺少页面: ${name}`);
  });
  htmlFiles.forEach((name) => {
    const file = path.join(webDir, name);
    checkHtmlFile(file).forEach((e) => errors.push(`[${name}] ${e}`));
  });

  ['common.css', 'login.css', 'home.css', 'pages.css'].forEach((name) => {
    const file = path.join(webDir, 'css', name);
    if (!fs.existsSync(file)) {
      errors.push(`缺少样式: css/${name}`);
      return;
    }
    checkCss(file).forEach((e) => errors.push(`[css/${name}] ${e}`));
  });

  checkVendor(root).forEach((e) => errors.push(`[vendor] ${e}`));

  ['app.js', 'index.js', 'static.js', 'config.js'].forEach((name) => {
    if (!fs.existsSync(path.join(root, 'server', name))) errors.push(`缺少后端文件: server/${name}`);
  });

  const jsFiles = [
    ...listFiles(path.join(root, 'server'), '.js'),
    ...listFiles(path.join(webDir, 'js'), '.js'),
    ...listFiles(path.join(root, 'tools'), '.js'),
  ];
  errors.push(...checkJsSyntax(jsFiles, root));

  return errors;
}

function runReverseTests(root) {
  const source = path.join(root, 'web', 'login.html');
  const probe = path.join(root, 'web', '_probe.html');
  const original = fs.readFileSync(source, 'utf8');

  const cases = [
    {
      name: '删除一个 </section>（标签未闭合）',
      apply: (s) => s.replace('</section>', '', 1),
    },
    {
      name: '往 head 注入 CDN 外链',
      apply: (s) => s.replace('</head>', '<script src="https://cdn.example.com/hack.js"></script>\n</head>'),
    },
    {
      name: '注入悬空锚点',
      apply: (s) => s.replace('</body>', '<a href="#missing-anchor">x</a>\n</body>'),
    },
    {
      name: '破坏 DOM id 引用',
      apply: (s) => s.replace(/id="btn-login"/g, 'id="btn-login-BROKEN"'),
    },
    {
      name: '删掉关键资源引用',
      apply: (s) => s.replace('<script src="js/api.js"></script>', ''),
    },
    {
      name: '品牌文案回退为「我的博客」（决策 8 反向验证）',
      apply: (s) => s.replace(/炫与梓/g, '我的博客'),
    },
  ];

  const results = [];
  try {
    cases.forEach((item) => {
      const mutated = item.apply(original);
      if (mutated === original) {
        results.push({ name: item.name, ok: false, why: '注入用例无效：内容未改变' });
        return;
      }
      fs.writeFileSync(probe, mutated, 'utf8');

      let code = 0;
      let output = '';
      try {
        cp.execFileSync(process.execPath, [__filename, '--file', probe], {
          stdio: 'pipe',
          cwd: root,
        });
      } catch (err) {
        code = Number(err.status) || 0;
        output = String(err.stderr || err.stdout || '').trim();
      }

      results.push({
        name: item.name,
        ok: code === 1,
        why: code === 1 ? output.split('\n')[0] : `退出码=${code}（自检未捕获）`,
      });
    });
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }
  return results;
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--file') {
    const file = path.resolve(args[1] || '');
    if (!fs.existsSync(file)) {
      console.error('文件不存在: ' + file);
      process.exit(1);
    }
    const errors = checkHtmlFile(file);
    if (errors.length > 0) {
      errors.forEach((e) => console.error('  - ' + e));
      process.exit(1);
    }
    console.log('OK: ' + path.basename(file));
    process.exit(0);
  }

  const root = args[0] ? path.resolve(args[0]) : ROOT;
  console.log('================ 交付物程序化自检 ================');
  console.log('项目根目录: ' + root);

  const errors = runAll(root);
  console.log('\n[1] 静态自检');
  if (errors.length === 0) {
    console.log('  PASS  标签配对 / 外部资源 / 本地资源 / 锚点 / 关键内容 / 禁止内容 / 品牌标题 / DOM id 引用 / CSS / vendor 零外链 / JS 语法');
  } else {
    errors.forEach((e) => console.log('  FAIL  ' + e));
  }

  console.log('\n[2] 反向注入测试（证明自检有效）');
  const reverse = runReverseTests(root);
  reverse.forEach((r) => {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? ' -> ' + r.why : ' | ' + r.why}`);
  });

  const failed = errors.length + reverse.filter((r) => !r.ok).length;
  console.log('\n==================================================');
  console.log(`结果: 静态错误 ${errors.length} 项，反向注入失败 ${reverse.filter((r) => !r.ok).length} 项`);
  if (failed > 0) {
    console.log('结论: 自检未通过');
    process.exit(1);
  }
  console.log('结论: 自检通过');
  process.exit(0);
}

main();
