'use strict';

/**
 * F3 影视资源（P3）：列表 / 筛选 / 增改 / 详情 / 状态变更 / 删除。
 *
 * 合规硬约束：本模块没有任何文件本体字段、不写 uploads、不生成播放源；
 * external_url 仅作文本保存与展示，页面显式加「本站不托管文件」免责说明。
 *
 * 安全约定：用户文本一律 textContent；external_url 以 textContent 展示并标注其为外链。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var ctx = { state: { guest: true }, setState: function () {} };
  var root;

  var TYPE_LABELS = { movie: '电影', series: '剧集', anime: '动画', documentary: '纪录片' };
  var WATCH_LABELS = { want: '想看', watching: '在看', watched: '看过' };
  var LINK_LABELS = { unchecked: '未核验', valid: '有效', invalid: '失效' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isGuest() { return !ctx.state || ctx.state.guest !== false; }
  function currentUser() { return (ctx.state && ctx.state.user) || {}; }
  function showContent(show) { if (root) root.hidden = !show; }

  function fail(message) {
    var errText = $('shell-error-text');
    if (errText) errText.textContent = message || '内容加载失败，请稍后重试。';
    ctx.setState('error');
    showContent(false);
  }

  function notice(message, kind) {
    if (!root) return;
    var box = $('media-notice') || $('article-notice');
    if (!box) {
      box = el('p', 'article-notice');
      box.id = 'media-notice';
      box.setAttribute('role', 'status');
      root.insertBefore(box, root.firstChild);
    }
    box.textContent = message;
    box.className = 'article-notice' + (kind === 'error' ? ' is-error' : '');
    box.hidden = false;
  }

  /* ---------------- 列表 ---------------- */

  async function renderList() {
    ctx.setState('loading');
    showContent(false);
    var params = { page: 1, size: 40 };
    var tab = (location.hash || '').replace(/^#\/?/, '') || 'public';
    if (tab === 'mine' && !isGuest()) params.mine = 1;
    // 筛选条件
    var typeSel = $('media-filter-type');
    var watchSel = $('media-filter-watch');
    var qInput = $('media-filter-q');
    if (typeSel && typeSel.value) params.type = typeSel.value;
    if (watchSel && watchSel.value) params.watch_status = watchSel.value;
    if (qInput && qInput.value.trim()) params.q = qInput.value.trim();

    var res;
    try {
      res = await window.BlogApi.listMedia(params);
    } catch (err) {
      fail(err && err.message ? err.message : '影视列表加载失败。');
      return;
    }
    var data = (res && res.data) || {};
    var items = data.items || [];
    if (!items.length) {
      ctx.setState('empty');
      showContent(false);
      return;
    }

    root.innerHTML = '';
    var head = el('div', 'section-head');
    var headText = el('div');
    headText.appendChild(el('h2', 'section-title', '影视资料库'));
    headText.appendChild(el('p', 'section-sub', '共 ' + (data.total || items.length) + ' 条 · 纯文本外链索引，本站不托管文件'));
    head.appendChild(headText);
    if (!isGuest()) {
      var add = el('button', 'btn btn-primary', '添加条目');
      add.type = 'button';
      add.addEventListener('click', function () { openEditor(null); });
      head.appendChild(add);
    }
    root.appendChild(head);

    root.appendChild(buildFilters());

    var grid = el('div', 'media-grid');
    items.forEach(function (m) {
      grid.appendChild(mediaCard(m));
    });
    root.appendChild(grid);

    if (data.hasMore) {
      var more = el('button', 'btn btn-ghost', '加载更多');
      more.type = 'button';
      more.addEventListener('click', function () { loadMore(grid, params, more); });
      root.appendChild(more);
    }

    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  async function loadMore(grid, params, btn) {
    params.page = (params.page || 1) + 1;
    btn.disabled = true;
    try {
      var res = await window.BlogApi.listMedia(params);
      var items = (res.data && res.data.items) || [];
      items.forEach(function (m) { grid.appendChild(mediaCard(m)); });
      if (!res.data.hasMore) btn.hidden = true;
      else btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      notice(err.message || '加载失败', 'error');
    }
  }

  function buildFilters() {
    var wrap = el('div', 'media-filters');
    var typeSel = el('select', 'text-input filter-input');
    typeSel.id = 'media-filter-type';
    addOpt(typeSel, '', '全部类型');
    Object.keys(TYPE_LABELS).forEach(function (k) { addOpt(typeSel, k, TYPE_LABELS[k]); });
    var watchSel = el('select', 'text-input filter-input');
    watchSel.id = 'media-filter-watch';
    addOpt(watchSel, '', '全部状态');
    Object.keys(WATCH_LABELS).forEach(function (k) { addOpt(watchSel, k, WATCH_LABELS[k]); });
    var qInput = el('input', 'text-input filter-input');
    qInput.id = 'media-filter-q';
    qInput.type = 'search';
    qInput.placeholder = '搜索标题 / 原名 / 导演';
    var apply = function () { renderList(); };
    typeSel.addEventListener('change', apply);
    watchSel.addEventListener('change', apply);
    qInput.addEventListener('input', debounce(apply, 350));
    wrap.appendChild(typeSel);
    wrap.appendChild(watchSel);
    wrap.appendChild(qInput);
    return wrap;
  }

  function addOpt(sel, value, label) {
    var o = el('option', null, label);
    o.value = value;
    sel.appendChild(o);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function mediaCard(m) {
    var card = el('article', 'media-card');
    var title = el('h3', 'media-card-title', m.title || '无题');
    card.appendChild(title);
    var sub = el('div', 'media-card-sub');
    sub.appendChild(el('span', null, TYPE_LABELS[m.type] || m.type || '—'));
    if (m.year) sub.appendChild(el('span', null, String(m.year)));
    if (m.rating != null) sub.appendChild(el('span', null, '★ ' + m.rating));
    card.appendChild(sub);
    var meta = el('div', 'media-card-meta');
    meta.appendChild(el('span', null, WATCH_LABELS[m.watchStatus] || m.watchStatus || '—'));
    if (m.linkStatus) {
      var ls = el('span', 'badge', LINK_LABELS[m.linkStatus] || m.linkStatus);
      if (m.linkStatus === 'invalid') ls.className = 'badge badge-draft';
      meta.appendChild(ls);
    }
    if (m.visibility === 'private') meta.appendChild(el('span', 'badge', '私有'));
    card.appendChild(meta);
    if (m.note) card.appendChild(el('p', 'media-card-note', m.note));

    var actions = el('div', 'media-card-actions');
    var open = el('button', 'btn btn-ghost btn-sm', '详情');
    open.type = 'button';
    open.addEventListener('click', function () { openDetail(m.id); });
    actions.appendChild(open);
    if (!isGuest() && currentUser().id === m.ownerId) {
      var edit = el('button', 'btn btn-ghost btn-sm', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', function () { openEditor(m); });
      var del = el('button', 'btn btn-ghost btn-sm is-danger', '删除');
      del.type = 'button';
      del.addEventListener('click', async function () {
        if (!window.confirm('确认删除该影视条目？')) return;
        try { await window.BlogApi.deleteMedia(m.id); renderList(); }
        catch (err) { notice(err.message || '删除失败', 'error'); }
      });
      actions.appendChild(edit);
      actions.appendChild(del);
    }
    card.appendChild(actions);
    return card;
  }

  /* ---------------- 详情 ---------------- */

  async function openDetail(id) {
    ctx.setState('loading');
    showContent(false);
    var res;
    try {
      res = await window.BlogApi.getMedia(id);
    } catch (err) {
      fail(err && err.status === 404 ? '条目不存在或已删除。' : (err && err.message));
      return;
    }
    var m = (res && res.data) || {};
    root.innerHTML = '';
    var art = el('article', 'media-detail');
    var bar = el('div', 'article-detail-bar');
    var back = el('a', 'btn btn-ghost btn-sm', '← 返回列表');
    back.href = '#/';
    bar.appendChild(back);
    art.appendChild(bar);

    art.appendChild(el('h1', 'article-detail-title', m.title || '无题'));
    var meta = el('div', 'article-detail-meta');
    var parts = [];
    if (m.type) parts.push(TYPE_LABELS[m.type] || m.type);
    if (m.year) parts.push(String(m.year));
    if (m.originalTitle) parts.push('原名：' + m.originalTitle);
    if (m.region) parts.push(m.region);
    if (m.director) parts.push('导演：' + m.director);
    parts.forEach(function (p) { meta.appendChild(el('span', null, p)); });
    art.appendChild(meta);

    if (m.rating != null) art.appendChild(el('p', 'media-rating', '评分：' + m.rating + ' / 10'));
    if (m.castSummary) art.appendChild(el('p', 'media-cast', '演员：' + m.castSummary));
    if (m.note) art.appendChild(el('p', 'media-note', m.note));

    if (m.watchedAtMs) art.appendChild(el('p', 'media-watched', '观看于 ' + fmtTime(m.watchedAtMs)));

    // 免责声明（硬约束）：外链仅文本展示，本站不托管文件
    var disc = el('p', 'media-disclaimer');
    disc.textContent = '本站仅保存并展示外链文本，不存储、不托管、不转存任何文件本体。';
    art.appendChild(disc);

    if (m.externalUrl) {
      var ul = el('div', 'media-links');
      var lab = el('div', 'field-label', '外链来源：' + (m.linkSource || '—') + (m.linkCode ? '（提取码：' + m.linkCode + '）' : ''));
      ul.appendChild(lab);
      // 外链作为纯文本展示（安全：不渲染为可点击跳转，避免诱导与跳转风险）
      var linkText = el('p', 'media-link-text', m.externalUrl);
      ul.appendChild(linkText);
      art.appendChild(ul);
    }

    // 作者可变更观看状态 / 评分
    if (!isGuest() && currentUser().id === m.ownerId) {
      art.appendChild(buildStatusEditor(m));
    }

    root.appendChild(art);
    showContent(true);
    ctx.setState('loading', 'hide-all');
    if (window.BlogInteractions && typeof window.BlogInteractions.mount === 'function') {
      window.BlogInteractions.mount(art, 'media', m.id, ctx.state);
    }
  }

  function buildStatusEditor(m) {
    var box = el('div', 'media-status-editor');
    box.appendChild(el('div', 'field-label', '更新我的观看记录'));
    var watchSel = el('select', 'text-input');
    [['want', '想看'], ['watching', '在看'], ['watched', '看过']].forEach(function (p) {
      var o = el('option', null, p[1]); o.value = p[0]; watchSel.appendChild(o);
    });
    watchSel.value = m.watchStatus || 'want';
    var rating = el('input', 'text-input');
    rating.type = 'number'; rating.min = '0'; rating.max = '10';
    rating.placeholder = '评分 0-10'; rating.value = (m.rating != null ? m.rating : '');
    var save = el('button', 'btn btn-primary btn-sm', '保存');
    save.type = 'button';
    save.addEventListener('click', async function () {
      save.disabled = true;
      try {
        await window.BlogApi.patchMediaStatus(m.id, {
          watch_status: watchSel.value,
          rating: rating.value === '' ? null : Number(rating.value),
        });
        notice('已更新观看记录');
        openDetail(m.id);
      } catch (err) {
        save.disabled = false;
        notice(err.message || '保存失败', 'error');
      }
    });
    box.appendChild(watchSel);
    box.appendChild(rating);
    box.appendChild(save);
    return box;
  }

  /* ---------------- 编辑器（新增 / 修改） ---------------- */

  function openEditor(m) {
    if (isGuest()) {
      ctx.setState('empty');
      var hint = $('shell-empty-hint');
      if (hint) hint.textContent = '添加影视条目需要先登录。';
      return;
    }
    ctx.setState('loading');
    root.innerHTML = '';
    var form = el('form', 'editor-form');
    form.setAttribute('novalidate', 'novalidate');

    form.appendChild(field('标题', inputEl('text', m ? m.title : '', '给这部作品起个标题', 200)));
    var optRow = el('div', 'editor-row');
    optRow.appendChild(field('类型', selectEl([['movie', '电影'], ['series', '剧集'], ['anime', '动画'], ['documentary', '纪录片']], m ? m.type : 'movie')));
    optRow.appendChild(field('年份', inputEl('number', m ? m.year : '', '如 2024', 4)));
    optRow.appendChild(field('可见性', selectEl([['public', '公开'], ['private', '私有']], m ? m.visibility : 'public')));
    form.appendChild(optRow);

    form.appendChild(field('外链 URL（纯文本索引，本站不托管文件）', inputEl('url', m ? m.externalUrl : '', 'https://...', 1024)));
    var row2 = el('div', 'editor-row');
    row2.appendChild(field('来源平台', inputEl('text', m ? m.linkSource : '', '如 某某云', 120)));
    row2.appendChild(field('提取码', inputEl('text', m ? m.linkCode : '', '可选', 64)));
    form.appendChild(row2);

    form.appendChild(field('原名（可选）', inputEl('text', m ? m.originalTitle : '', '', 200)));
    form.appendChild(field('地区（可选）', inputEl('text', m ? m.region : '', '', 64)));
    form.appendChild(field('导演（可选）', inputEl('text', m ? m.director : '', '', 120)));
    form.appendChild(field('演员摘要（可选）', inputEl('text', m ? m.castSummary : '', '', 500)));
    form.appendChild(field('短评（可选）', textareaEl(m ? m.note : '', 1000)));

    var actions = el('div', 'editor-actions');
    var cancel = el('a', 'btn btn-ghost', '取消');
    cancel.href = '#/';
    var save = el('button', 'btn btn-primary', m ? '更新' : '添加');
    save.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var payload = {
        title: val(form, 0),
        type: selVal(form, 1),
        year: numOrNull(val(form, 2)),
        visibility: selVal(form, 3),
        external_url: val(form, 4) || null,
        link_source: val(form, 5) || null,
        link_code: val(form, 6) || null,
        original_title: val(form, 7) || null,
        region: val(form, 8) || null,
        director: val(form, 9) || null,
        cast_summary: val(form, 10) || null,
        note: val(form, 11) || null,
      };
      if (!payload.title) { notice('请填写标题', 'error'); return; }
      save.disabled = true;
      try {
        if (m) await window.BlogApi.updateMedia(m.id, payload);
        else await window.BlogApi.createMedia(payload);
        location.hash = '#/';
      } catch (err) {
        save.disabled = false;
        notice(err.message || '保存失败', 'error');
      }
    });

    root.appendChild(form);
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  // 表单辅助：按字段顺序定位 input/select/textarea
  function field(labelText, control) {
    var f = el('div', 'field');
    var l = el('label', 'field-label', labelText);
    f.appendChild(l);
    f.appendChild(control);
    return f;
  }
  function inputEl(type, value, placeholder, max) {
    var i = el('input', 'text-input');
    i.type = type; if (value != null) i.value = value;
    if (placeholder) i.placeholder = placeholder;
    if (max) i.maxLength = max;
    return i;
  }
  function selectEl(options, value) {
    var s = el('select', 'text-input');
    options.forEach(function (p) { var o = el('option', null, p[1]); o.value = p[0]; s.appendChild(o); });
    if (value != null) s.value = value;
    return s;
  }
  function textareaEl(value, max) {
    var t = el('textarea', 'text-input editor-textarea');
    if (value) t.value = value;
    if (max) t.maxLength = max;
    return t;
  }
  function val(form, idx) {
    var node = form.querySelectorAll('.field .text-input, .field textarea')[idx];
    return node ? node.value.trim() : '';
  }
  function selVal(form, idx) {
    var node = form.querySelectorAll('.field .text-input, .field textarea')[idx];
    return node ? node.value : '';
  }
  function numOrNull(s) {
    if (!s) return null;
    var n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }

  /* ---------------- 分发 ---------------- */

  function render() {
    var hash = (location.hash || '').replace(/^#\/?/, '');
    if (hash.indexOf('detail/') === 0) return openDetail(hash.slice(7));
    if (hash === 'new' || hash === 'mine') return renderList();
    return renderList();
  }

  window.BlogPage = {
    // 空态「添加条目」与列表头按钮共用同一个编辑器
    onCreate: function () { openEditor(null); },
    init: function (context) {
      ctx = context || ctx;
      root = $('content-root');
      if (!root) { ctx.setState('empty'); return; }
      var orig = ctx.setState;
      ctx.setState = function (name, mode) {
        if (mode === 'hide-all') {
          ['state-loading', 'state-empty', 'state-error'].forEach(function (id) {
            var n = $(id); if (n) n.hidden = true;
          });
          return;
        }
        orig(name);
      };
      window.addEventListener('hashchange', function () { render(); });
      render();
    },
  };
})();
