'use strict';

/**
 * 主页（P1 双态欢迎区 + P2 F1 站点聚合）。
 *
 * P1：下拉 / 导航 / 登出 / 双态顶栏 / 背景已抽到 js/site.js，本文件只渲染欢迎区。
 * P2：追加 F1 聚合区（统计卡、最近动态、快捷操作），全部走公开读接口，
 *     访客也能看到公开内容；快捷操作仅登录态显示。
 *
 * 空态优先（P8′）：任一模块无数据时显示引导文案，不渲染「一片 0」的卡片。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function formatTime(iso) {
    if (!iso) return '—';
    try {
      var date = new Date(iso);
      if (isNaN(date.getTime())) return '—';
      return date.toLocaleString('zh-CN', { hour12: false });
    } catch (err) {
      return '—';
    }
  }

  function fmtMs(ms) {
    if (!ms) return '—';
    return formatTime(new Date(Number(ms)).toISOString());
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function renderGuest() {
    $('welcome-title').textContent = '欢迎来到 炫与梓';
    $('welcome-desc').textContent = '一个关于记录、收藏与日常的地方。公开内容无需登录即可浏览。';
    $('hero-session').hidden = true;
    $('hero-guest').hidden = false;
  }

  function renderLoggedIn(state) {
    var user = state.user || {};
    var session = state.session || {};
    var nickname = user.nickname || '博主';
    $('welcome-title').textContent = '欢迎回来，' + nickname;
    $('welcome-desc').textContent = '你已通过服务端会话校验，可以开始管理你的博客内容。';
    $('meta-created').textContent = formatTime(session.createdAt);
    $('meta-expires').textContent = formatTime(session.expiresAt);
    $('hero-session').hidden = false;
    $('hero-guest').hidden = true;
  }

  /* ---------------- F1 聚合区 ---------------- */

  var STAT_DEFS = [
    { key: 'article', label: '文章', href: 'articles.html' },
    { key: 'media', label: '影视条目', href: 'media.html' },
    { key: 'vault', label: '宝库条目', href: 'vault.html' },
    { key: 'moment', label: '碎碎念', href: 'moments.html' },
  ];

  function renderStats(counts) {
    var grid = el('div', 'stat-grid');
    STAT_DEFS.forEach(function (def) {
      var card = el('a', 'stat-card');
      card.href = def.href;
      var value = (counts && counts[def.key]) || 0;
      card.appendChild(el('span', 'stat-value', String(value)));
      card.appendChild(el('span', 'stat-label', def.label));
      grid.appendChild(card);
    });
    return grid;
  }

  function recentHref(item) {
    switch (item.type) {
      case 'article': return 'articles.html#/p/' + item.id;
      case 'media': return 'media.html#/detail/' + item.id;
      case 'collection': return 'vault.html#/c/' + item.id;
      case 'moment': return 'moments.html';
      default: return 'articles.html';
    }
  }

  function renderRecent(items) {
    var section = el('section', 'home-section');
    var head = el('div', 'section-head');
    var textBox = el('div');
    textBox.appendChild(el('h2', 'section-title', '最近动态'));
    textBox.appendChild(el('p', 'section-sub', '跨模块时间线，按发布时间倒序'));
    head.appendChild(textBox);
    section.appendChild(head);

    if (!items || !items.length) {
      // 空态优先：不渲染空列表，给引导入口
      var empty = el('div', 'home-empty');
      empty.appendChild(el('p', null, '这里还很安静。写下第一篇文章，或者去收藏一些喜欢的东西。'));
      var actions = el('div', 'state-actions');
      var toArticles = el('a', 'btn btn-ghost', '去看看文章');
      toArticles.href = 'articles.html';
      actions.appendChild(toArticles);
      empty.appendChild(actions);
      section.appendChild(empty);
      return section;
    }

    var TYPE_LABELS = { article: '文章', media: '影视', collection: '宝库', moment: '碎碎念' };
    var list = el('ul', 'recent-list');
    items.forEach(function (item) {
      var li = el('li', 'recent-item');
      var link = el('a', 'recent-link');
      link.href = recentHref(item);
      link.appendChild(el('span', 'recent-title', item.title || '无题'));
      li.appendChild(link);
      var meta = el('div', 'recent-meta');
      meta.appendChild(el('span', 'recent-type', TYPE_LABELS[item.type] || '动态'));
      meta.appendChild(el('span', null, item.authorName || '匿名'));
      meta.appendChild(el('span', null, fmtMs(item.createdAtMs)));
      li.appendChild(meta);
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  function renderQuickActions() {
    var section = el('section', 'home-section');
    section.appendChild(el('h2', 'section-title', '快捷操作'));
    var row = el('div', 'quick-actions');
    [
      { label: '写文章', href: 'articles.html#/new' },
      { label: '记一条碎碎念', href: 'moments.html' },
      { label: '添加影视条目', href: 'media.html' },
      { label: '新建收藏集合', href: 'vault.html' },
    ].forEach(function (a) {
      var link = el('a', 'btn btn-ghost btn-sm', a.label);
      link.href = a.href;
      row.appendChild(link);
    });
    section.appendChild(row);
    return section;
  }

  async function renderHome(state) {
    var host = $('home-content');
    if (!host) return;

    var res;
    try {
      res = await window.BlogApi.homeSummary(6);
    } catch (err) {
      // 聚合失败不应阻塞主页：静默降级，仅保留欢迎区
      return;
    }
    var data = (res && res.data) || {};
    host.innerHTML = '';
    host.appendChild(renderStats(data.counts));
    host.appendChild(renderRecent(data.recent));
    if (state && state.guest === false) host.appendChild(renderQuickActions());
    host.hidden = false;
  }

  (async function () {
    var state = await window.BlogGuard.optionalLogin();
    window.BlogSite.renderSession(state);
    if (state && state.guest === false) renderLoggedIn(state);
    else renderGuest();
    renderHome(state);
  })();
})();
