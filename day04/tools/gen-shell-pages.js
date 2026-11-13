'use strict';

/**
 * P1 页面壳生成器（§7 同批交付 / §8 三态齐备）。
 *
 * 7 个业务页 / 分享页共用完全一致的顶栏与内容区骨架，由本脚本统一产出：
 *   - 顶栏：品牌 + 5 项真实链接导航 + 访客/登录双态用户区 + 移动端折叠
 *   - 内容区：加载态 / 空态 / 错误态三态
 *   - 脚本：config / api / auth-guard / background / site / page-shell
 *
 * 之所以用生成器而非逐页手写：selfcheck.js 会逐页校验「JS 中引用的 DOM id
 * 必须在 HTML 中存在」，任何一页漏写一个 id 都会导致静态自检失败。
 *
 * 用法: node tools/gen-shell-pages.js
 * 说明: 本生成器是交付物的一部分，页面骨架调整后应重新运行并全量自检。
 */
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.resolve(__dirname, '..', 'web');

const NAV = [
  ['home', 'home.html', '主页'],
  ['articles', 'articles.html', '文章'],
  ['media', 'media.html', '影视资源'],
  ['vault', 'vault.html', 'げん的宝库'],
  ['moments', 'moments.html', '碎碎念'],
];

const PAGES = [
  {
    file: 'articles.html', page: 'articles', nav: 'articles',
    title: '文章 · 炫与梓', kicker: 'F2 · 长内容', heading: '文章',
    desc: '长文发布与阅读：分类、标签、Markdown 编辑与归档。',
    empty: '还没有发布过文章。第一篇可以写写这个站点是怎么搭起来的。',
  },
  {
    file: 'media.html', page: 'media', nav: 'media',
    title: '影视资源 · 炫与梓', kicker: 'F3 · 观影资料库', heading: '影视资源',
    desc: '个人观影资料库与外链索引；本站不存储、不托管、不转存文件本体。',
    empty: '片单还是空的。可以先把最近想看的几部登记进来。',
  },
  {
    file: 'vault.html', page: 'vault', nav: 'vault',
    title: 'げん的宝库 · 炫与梓', kicker: 'F4 · 私人收藏夹', heading: 'げん的宝库',
    desc: '链接 / 图片 / 书单 / 代码片段的两级收藏库（集合 + 条目）。',
    empty: '还没有收藏集合。新建一个集合，把散落各处的链接收进来。',
  },
  {
    file: 'moments.html', page: 'moments', nav: 'moments',
    title: '碎碎念 · 炫与梓', kicker: 'F5 · 轻动态', heading: '碎碎念',
    desc: '无标题、无独立详情页的时间线，适合记录当下的短句。',
    empty: '还没有碎碎念。随手记一句，之后回看会很有意思。',
  },
  {
    file: 'profile.html', page: 'profile', nav: null,
    title: '个人资料 · 炫与梓', kicker: 'F6 · 个人资料', heading: '个人资料',
    desc: '头像、昵称、简介与公开内容概览；手机号仅脱敏展示。',
    empty: '资料编辑与公开主页将在后续阶段开放，当前为只读页面壳。',
  },
  {
    file: 'settings.html', page: 'settings', nav: null,
    title: '账号设置 · 炫与梓', kicker: 'F7 · 账号设置', heading: '账号设置',
    desc: '安全（改密 / 会话 / 登录记录）、偏好与危险操作三个分区。',
    empty: '账号设置项将在后续阶段开放，当前为只读页面壳。',
  },
  {
    file: 'share.html', page: 'share', nav: null, noindex: true,
    title: '分享内容 · 炫与梓', kicker: 'F8 · 分享只读页', heading: '分享内容',
    desc: '持有效分享链接即可只读查看，无需登录；页面不被搜索引擎索引。',
    empty: '此分享链接暂无可展示的内容，或链接已过期 / 已撤销。',
  },
];

function navHtml(current) {
  return NAV.map(function (item) {
    var active = item[0] === current;
    var cls = active ? 'nav-link is-active' : 'nav-link';
    var attr = active ? ' aria-current="page"' : '';
    return '        <a class="' + cls + '" data-nav="' + item[0] +
      '" href="' + item[1] + '"' + attr + '>' + item[2] + '</a>';
  }).join('\n');
}

function build(p) {
  var lines = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta name="color-scheme" content="light">',
    p.noindex ? '  <meta name="robots" content="noindex">' : null,
    '  <title>' + p.title + '</title>',
    '  <link rel="stylesheet" href="css/common.css">',
    '  <link rel="stylesheet" href="css/home.css">',
    '  <link rel="stylesheet" href="css/pages.css">',
    '</head>',
    '<body class="guard-pending" data-page="' + p.page + '">',
    '  <div id="bg-layer" class="bg-layer" aria-hidden="true"></div>',
    '',
    '  <header class="topbar">',
    '    <div class="topbar-inner">',
    '      <a class="brand-inline" href="home.html">',
    '        <img class="brand-avatar" src="assets/head.png" alt="">',
    '        <span class="brand-name">炫与梓</span>',
    '      </a>',
    '',
    '      <!-- 决策 6：5 项导航一次性全部启用为真实链接，文案逐字不变 -->',
    '      <nav class="nav" id="main-nav" aria-label="主导航">',
    navHtml(p.nav),
    '      </nav>',
    '',
    '      <div class="user-area">',
    '        <!-- 访客态顶栏（决策 2）：匿名显示登录 / 注册入口 -->',
    '        <div class="guest-actions" id="user-guest">',
    '          <a class="btn btn-ghost" href="login.html">登录</a>',
    '          <a class="btn btn-primary btn-sm" href="login.html?tab=register">注册</a>',
    '        </div>',
    '',
    '        <!-- 登录态顶栏：头像下拉；2 个下拉项同批启用为可用链接 -->',
    '        <div class="user-menu" id="user-session" hidden>',
    '          <button class="user-trigger" id="user-menu-btn" type="button"',
    '                  aria-haspopup="menu" aria-expanded="false" aria-controls="user-dropdown">',
    '            <img class="avatar" id="user-avatar" src="assets/head.png" alt="用户头像">',
    '            <span class="user-name" id="user-name">加载中</span>',
    '            <span class="chevron" aria-hidden="true"></span>',
    '          </button>',
    '',
    '          <div class="user-dropdown" id="user-dropdown" role="menu" hidden>',
    '            <div class="dropdown-head">',
    '              <img class="dropdown-avatar" src="assets/head.png" alt="">',
    '              <div class="dropdown-id">',
    '                <strong id="dropdown-name">加载中</strong>',
    '                <span id="dropdown-phone">—</span>',
    '              </div>',
    '            </div>',
    '',
    '            <div class="dropdown-list">',
    '              <a class="dropdown-item" role="menuitem" href="profile.html">',
    '                <span class="item-icon" aria-hidden="true">◇</span>',
    '                <span class="item-label">个人资料</span>',
    '              </a>',
    '              <a class="dropdown-item" role="menuitem" href="settings.html">',
    '                <span class="item-icon" aria-hidden="true">◇</span>',
    '                <span class="item-label">账号设置</span>',
    '              </a>',
    '            </div>',
    '',
    '            <div class="dropdown-divider" role="separator"></div>',
    '',
    '            <div class="dropdown-foot">',
    '              <button class="dropdown-item is-danger" id="btn-logout" type="button" role="menuitem">',
    '                <span class="item-icon" aria-hidden="true">↪</span>',
    '                <span class="item-label">退出登录</span>',
    '              </button>',
    '            </div>',
    '          </div>',
    '        </div>',
    '      </div>',
    '',
    '      <button class="nav-toggle" id="nav-toggle" type="button" aria-label="展开导航" aria-expanded="false">☰</button>',
    '    </div>',
    '  </header>',
    '',
    '  <main class="page">',
    '    <section class="hero shell-card">',
    '      <div class="shell-head">',
    '        <span class="shell-kicker" id="shell-kicker">' + p.kicker + '</span>',
    '        <h1 id="shell-title">' + p.heading + '</h1>',
    '        <p class="hero-desc" id="shell-desc">' + p.desc + '</p>',
    '      </div>',
    '',
    '      <!-- 三态：加载 / 空 / 错误（P8′ 硬要求，页面壳阶段统一收敛到空态） -->',
    '      <div class="state-pane" id="state-loading" role="status">',
    '        <span class="state-spinner" aria-hidden="true"></span>',
    '        <p>正在加载内容…</p>',
    '      </div>',
    '',
    '      <div class="state-pane" id="state-empty" hidden>',
    '        <div class="state-art" aria-hidden="true">◇</div>',
    '        <h2>这里还没有内容</h2>',
    '        <p id="shell-empty-hint">' + p.empty + '</p>',
    '        <div class="state-actions">',
    '          <button class="btn btn-primary" id="shell-create" type="button" hidden>去创建</button>',
    '          <a class="btn btn-ghost" href="home.html">返回主页</a>',
    '        </div>',
    '        <p class="state-guest" id="shell-guest-hint">登录后即可发布与管理内容。</p>',
    '        <p class="shell-notice" id="shell-notice" role="status" hidden></p>',
    '      </div>',
    '',
    '      <div class="state-pane" id="state-error" role="alert" hidden>',
    '        <div class="state-art" aria-hidden="true">!</div>',
    '        <h2>加载失败</h2>',
    '        <p id="shell-error-text">内容加载失败，请稍后重试。</p>',
    '        <button class="btn btn-ghost" id="shell-retry" type="button">重新加载</button>',
    '      </div>',
    '    </section>',
    '  </main>',
    '',
    '  <script src="js/config.js"></script>',
    '  <script src="js/api.js"></script>',
    '  <script src="js/auth-guard.js"></script>',
    '  <script src="js/background.js"></script>',
    '  <script src="js/site.js"></script>',
    '  <script src="js/page-shell.js"></script>',
    '</body>',
    '</html>',
  ];
  return lines.filter(function (line) { return line !== null; }).join('\n') + '\n';
}

PAGES.forEach(function (p) {
  fs.writeFileSync(path.join(WEB, p.file), build(p), 'utf8');
  console.log('generated web/' + p.file);
});
console.log('共生成 ' + PAGES.length + ' 个页面壳');
