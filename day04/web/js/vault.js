'use strict';

/**
 * F4 私人宝库（P3）：两级收藏（集合 + 条目），条目为外链索引，零托管文件。
 * 越权与不存在统一 404；公开分享页匿名只读，可选访问口令。
 *
 * 安全约定：用户文本一律 textContent；外链以纯文本展示。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var ctx = { state: { guest: true }, setState: function () {} };
  var root;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
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
    var box = $('vault-notice') || $('article-notice');
    if (!box) {
      box = el('p', 'article-notice');
      box.id = 'vault-notice';
      box.setAttribute('role', 'status');
      root.insertBefore(box, root.firstChild);
    }
    box.textContent = message;
    box.className = 'article-notice' + (kind === 'error' ? ' is-error' : '');
    box.hidden = false;
  }

  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  /* ---------------- 集合列表 ---------------- */

  async function renderList() {
    ctx.setState('loading');
    showContent(false);
    var res;
    try {
      res = await window.BlogApi.listCollections({ mine: 1, size: 50 });
    } catch (err) {
      fail(err && err.message ? err.message : '收藏集合加载失败。');
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
    var ht = el('div');
    ht.appendChild(el('h2', 'section-title', '我的收藏集'));
    ht.appendChild(el('p', 'section-sub', '共 ' + (data.total || items.length) + ' 个集合 · 两级收藏（集合 + 条目），零托管文件'));
    head.appendChild(ht);
    if (!isGuest()) {
      var add = el('button', 'btn btn-primary', '新建集合');
      add.type = 'button';
      add.addEventListener('click', function () { openCollectionEditor(null); });
      head.appendChild(add);
    }
    root.appendChild(head);

    var grid = el('div', 'vault-grid');
    items.forEach(function (c) {
      var card = el('article', 'vault-card');
      var name = el('h3', 'vault-card-name');
      var link = el('a', null, c.name || '未命名');
      link.href = '#/c/' + c.id;
      name.appendChild(link);
      card.appendChild(name);
      if (c.description) card.appendChild(el('p', 'vault-card-desc', c.description));
      var meta = el('div', 'vault-card-meta');
      meta.appendChild(el('span', null, (c.itemCount || 0) + ' 条'));
      if (c.visibility === 'public') meta.appendChild(el('span', 'badge', '公开'));
      else meta.appendChild(el('span', 'badge', '私有'));
      card.appendChild(meta);

      if (!isGuest() && currentUser().id === c.ownerId) {
        var actions = el('div', 'vault-card-actions');
        var edit = el('button', 'btn btn-ghost btn-sm', '编辑');
        edit.type = 'button';
        edit.addEventListener('click', function () { openCollectionEditor(c); });
        var del = el('button', 'btn btn-ghost btn-sm is-danger', '删除');
        del.type = 'button';
        del.addEventListener('click', async function () {
          if (!window.confirm('删除该集合会一并删除其中所有条目，确认？')) return;
          try { await window.BlogApi.deleteCollection(c.id); renderList(); }
          catch (err) { notice(err.message || '删除失败', 'error'); }
        });
        actions.appendChild(edit);
        actions.appendChild(del);
        card.appendChild(actions);
      }
      grid.appendChild(card);
    });
    root.appendChild(grid);
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  /* ---------------- 集合详情 ---------------- */

  async function openDetail(id) {
    ctx.setState('loading');
    showContent(false);
    var res;
    try {
      res = await window.BlogApi.getCollection(id);
    } catch (err) {
      fail(err && err.status === 404 ? '收藏集不存在或已删除。' : (err && err.message));
      return;
    }
    var c = (res && res.data) || {};
    var isOwner = !isGuest() && currentUser().id === c.ownerId;
    root.innerHTML = '';

    var bar = el('div', 'article-detail-bar');
    var back = el('a', 'btn btn-ghost btn-sm', '← 返回集合');
    back.href = '#/';
    bar.appendChild(back);
    if (isOwner) {
      var add = el('button', 'btn btn-primary btn-sm', '添加条目');
      add.type = 'button';
      add.addEventListener('click', function () { openItemEditor(c, null); });
      bar.appendChild(add);
    }
    root.appendChild(bar);

    root.appendChild(el('h1', 'article-detail-title', c.name || '未命名'));
    if (c.description) root.appendChild(el('p', 'article-detail-meta', c.description));
    if (c.visibility === 'public') {
      var share = el('p', 'vault-share-hint');
      share.textContent = '这是一个公开集合，任何人都可查看。';
      root.appendChild(share);
      if (isOwner) {
        var shareBtn = el('button', 'btn btn-ghost btn-sm', '生成分享链接');
        shareBtn.type = 'button';
        shareBtn.addEventListener('click', async function () { await createShareLink(c.id); });
        root.appendChild(shareBtn);
      }
    }

    var items = c.items || [];
    if (!items.length) {
      root.appendChild(el('p', 'vault-empty-items', '该集合还没有条目。'));
    } else {
      var list = el('div', 'vault-items');
      items.forEach(function (it) { list.appendChild(itemRow(c, it, items, isOwner)); });
      root.appendChild(list);
    }
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  async function createShareLink(collectionId) {
    try {
      var res = await window.BlogApi.createShare({ target_type: 'collection', target_id: collectionId });
      var data = (res && res.data) || {};
      var url = (window.location.origin + window.location.pathname).replace(/[^/]+$/, '') + 'share.html?token=' + data.token;
      var box = el('p', 'vault-share-link');
      box.textContent = '分享链接（匿名可读）：' + url;
      var prev = $('vault-share-link');
      if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
      root.insertBefore(box, root.firstChild);
    } catch (err) {
      notice(err.message || '生成分享链接失败', 'error');
    }
  }

  function itemRow(c, it, items, isOwner) {
    var row = el('div', 'vault-item');
    row.setAttribute('data-id', it.id);
    var main = el('div', 'vault-item-main');
    main.appendChild(el('span', 'vault-item-title', it.title || '未命名'));
    if (it.type === 'url' && it.url) {
      // 外链纯文本展示（不渲染为可点击跳转）
      main.appendChild(el('span', 'vault-item-url', it.url));
    }
    if (it.note) main.appendChild(el('p', 'vault-item-note', it.note));
    if (it.linkStatus && it.linkStatus !== 'unchecked') {
      main.appendChild(el('span', 'badge', it.linkStatus === 'invalid' ? '失效' : (it.linkStatus === 'valid' ? '有效' : it.linkStatus)));
    }
    row.appendChild(main);

    if (isOwner) {
      var actions = el('div', 'vault-item-actions');
      var idx = items.findIndex(function (x) { return x.id === it.id; });
      var up = el('button', 'btn btn-ghost btn-sm', '↑');
      up.type = 'button'; up.title = '上移';
      up.disabled = idx <= 0;
      up.addEventListener('click', function () { reorder(c, items, idx, idx - 1); });
      var down = el('button', 'btn btn-ghost btn-sm', '↓');
      down.type = 'button'; down.title = '下移';
      down.disabled = idx >= items.length - 1;
      down.addEventListener('click', function () { reorder(c, items, idx, idx + 1); });
      var edit = el('button', 'btn btn-ghost btn-sm', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', function () { openItemEditor(c, it); });
      var del = el('button', 'btn btn-ghost btn-sm is-danger', '删除');
      del.type = 'button';
      del.addEventListener('click', async function () {
        if (!window.confirm('确认删除该条目？')) return;
        try { await window.BlogApi.deleteCollectionItem(c.id, it.id); openDetail(c.id); }
        catch (err) { notice(err.message || '删除失败', 'error'); }
      });
      [up, down, edit, del].forEach(function (b) { actions.appendChild(b); });
      row.appendChild(actions);
    }
    return row;
  }

  async function reorder(c, items, from, to) {
    if (to < 0 || to >= items.length) return;
    var ids = items.map(function (x) { return x.id; });
    var moved = ids.splice(from, 1)[0];
    ids.splice(to, 0, moved);
    try {
      await window.BlogApi.setCollectionOrder(c.id, ids);
      openDetail(c.id);
    } catch (err) { notice(err.message || '排序失败', 'error'); }
  }

  function openCollectionEditor(c) {
    if (isGuest()) {
      ctx.setState('empty');
      var hint = $('shell-empty-hint');
      if (hint) hint.textContent = '新建收藏集需要先登录。';
      return;
    }
    ctx.setState('loading');
    root.innerHTML = '';
    var form = el('form', 'editor-form');
    form.setAttribute('novalidate', 'novalidate');
    form.appendChild(field('集合名称', inputEl('text', c ? c.name : '', '给集合起个名字', 60)));
    form.appendChild(field('简介（可选）', textareaEl(c ? c.description : '', 500)));
    form.appendChild(field('可见性', selectEl([['private', '私有（默认）'], ['public', '公开（匿名可读）']], c ? c.visibility : 'private')));
    var pwField = field('访问口令（仅公开集合可选）', inputEl('text', c ? c.sharePassword : '', '可选', 64));
    form.appendChild(pwField);

    var actions = el('div', 'editor-actions');
    var cancel = el('a', 'btn btn-ghost', '取消'); cancel.href = '#/';
    var save = el('button', 'btn btn-primary', c ? '更新' : '创建'); save.type = 'submit';
    actions.appendChild(cancel); actions.appendChild(save);
    form.appendChild(actions);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = form.querySelectorAll('.field .text-input, .field textarea')[0].value.trim();
      var desc = form.querySelectorAll('.field .text-input, .field textarea')[1].value.trim();
      var vis = form.querySelectorAll('select')[0].value;
      var pw = form.querySelectorAll('.field .text-input, .field textarea')[2].value.trim();
      if (!name) { notice('请填写集合名称', 'error'); return; }
      var payload = { name: name, description: desc || null, visibility: vis, share_password: vis === 'public' ? (pw || null) : null };
      save.disabled = true;
      try {
        if (c) await window.BlogApi.updateCollection(c.id, payload);
        else await window.BlogApi.createCollection(payload);
        location.hash = '#/';
      } catch (err) { save.disabled = false; notice(err.message || '保存失败', 'error'); }
    });
    root.appendChild(form);
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  function openItemEditor(c, it) {
    ctx.setState('loading');
    root.innerHTML = '';
    var form = el('form', 'editor-form');
    form.setAttribute('novalidate', 'novalidate');
    form.appendChild(field('标题', inputEl('text', it ? it.title : '', '条目标题', 200)));
    form.appendChild(field('类型', selectEl([['url', '链接'], ['text', '纯文本']], it ? it.type : 'url')));
    form.appendChild(field('链接 URL（纯文本索引）', inputEl('url', it ? it.url : '', 'https://...', 2048)));
    form.appendChild(field('备注（可选）', textareaEl(it ? it.note : '', 1000)));

    var actions = el('div', 'editor-actions');
    var cancel = el('a', 'btn btn-ghost', '取消'); cancel.href = '#/c/' + c.id;
    var save = el('button', 'btn btn-primary', it ? '更新' : '添加'); save.type = 'submit';
    actions.appendChild(cancel); actions.appendChild(save);
    form.appendChild(actions);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var title = form.querySelectorAll('.field .text-input, .field textarea')[0].value.trim();
      var type = form.querySelectorAll('select')[0].value;
      var url = form.querySelectorAll('.field .text-input, .field textarea')[1].value.trim();
      var note = form.querySelectorAll('.field .text-input, .field textarea')[2].value.trim();
      if (!title) { notice('请填写标题', 'error'); return; }
      var payload = { title: title, type: type, url: type === 'url' ? (url || null) : null, note: note || null };
      save.disabled = true;
      try {
        if (it) await window.BlogApi.updateCollectionItem(c.id, it.id, payload);
        else await window.BlogApi.createCollectionItem(c.id, payload);
        navigate('#/c/' + c.id);
      } catch (err) { save.disabled = false; notice(err.message || '保存失败', 'error'); }
    });
    root.appendChild(form);
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  function field(labelText, control) {
    var f = el('div', 'field');
    f.appendChild(el('label', 'field-label', labelText));
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

  function render() {
    var hash = (location.hash || '').replace(/^#\/?/, '');
    if (hash.indexOf('c/') === 0) return openDetail(hash.slice(2));
    return renderList();
  }

  window.BlogPage = {
    // 空态「新建集合」与列表头按钮共用同一个编辑器
    onCreate: function () { openCollectionEditor(null); },
    init: function (context) {
      ctx = context || ctx;
      root = $('content-root');
      if (!root) { ctx.setState('empty'); return; }
      var orig = ctx.setState;
      ctx.setState = function (name, mode) {
        if (mode === 'hide-all') {
          ['state-loading', 'state-empty', 'state-error'].forEach(function (id) { var n = $(id); if (n) n.hidden = true; });
          return;
        }
        orig(name);
      };
      window.addEventListener('hashchange', function () { render(); });
      render();
    },
  };
})();
