'use strict';

/**
 * F5 碎碎念（P3）：无标题、无独立详情页的游标时间线。
 *
 * 游标分页：before=created_at_ms+id，size；不重不漏。主页快捷发布复用同一编辑器。
 * 安全约定：用户文本一律 textContent；图片仅保存 URL 文本，不渲染为可点击外链。
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

  function fmtTime(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
    var box = $('moments-notice') || $('article-notice');
    if (!box) {
      box = el('p', 'article-notice');
      box.id = 'moments-notice';
      box.setAttribute('role', 'status');
      root.insertBefore(box, root.firstChild);
    }
    box.textContent = message;
    box.className = 'article-notice' + (kind === 'error' ? ' is-error' : '');
    box.hidden = false;
  }

  var cursor = null;
  var loadingMore = false;

  async function renderTimeline(reset) {
    if (reset) { cursor = null; ctx.setState('loading'); showContent(false); }
    var params = { size: 20 };
    if (cursor) params.before = cursor;

    var res;
    try {
      res = await window.BlogApi.listMoments(params);
    } catch (err) {
      fail(err && err.message ? err.message : '碎碎念加载失败。');
      return;
    }
    var data = (res && res.data) || {};
    var items = data.items || [];

    if (reset) {
      root.innerHTML = '';
      if (!isGuest()) root.appendChild(buildComposer());
    }

    if (!items.length && reset) {
      ctx.setState('empty');
      showContent(false);
      // 仍展示发布框（登录态）
      if (!isGuest()) { showContent(true); }
      return;
    }
    if (items.length) {
      var feed = $('moments-feed');
      if (!feed) {
        feed = el('div', 'moments-feed');
        feed.id = 'moments-feed';
        root.appendChild(feed);
      }
      items.forEach(function (m) { feed.appendChild(momentCard(m)); });
      cursor = data.nextCursor || null;
    }

    // 加载更多按钮
    var more = $('moments-more');
    if (more) more.remove();
    if (data.hasMore) {
      var btn = el('button', 'btn btn-ghost', '加载更早');
      btn.id = 'moments-more';
      btn.type = 'button';
      btn.addEventListener('click', function () { loadEarlier(); });
      root.appendChild(btn);
    }

    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  async function loadEarlier() {
    if (loadingMore) return;
    loadingMore = true;
    await renderTimeline(false);
    loadingMore = false;
  }

  function momentCard(m) {
    var card = el('article', 'moment-card');
    card.setAttribute('data-id', m.id);
    var head = el('div', 'moment-head');
    head.appendChild(el('span', 'moment-author', m.authorName || '匿名'));
    head.appendChild(el('span', 'moment-time', fmtTime(m.createdAtMs)));
    if (m.pinned) head.appendChild(el('span', 'badge', '置顶'));
    if (m.visibility === 'private') head.appendChild(el('span', 'badge', '私有'));
    card.appendChild(head);

    // 内容：唯一允许展示用户文本之处，使用 textContent（服务端已做净化边界，前端不二次渲染）
    card.appendChild(el('p', 'moment-content', m.content || ''));

    if (m.images && m.images.length) {
      var imgs = el('div', 'moment-images');
      m.images.slice(0, 9).forEach(function (url) {
        imgs.appendChild(el('span', 'moment-image-url', url)); // 仅展示 URL 文本，不渲染图片
      });
      card.appendChild(imgs);
    }

    if (!isGuest() && currentUser().id === m.authorId) {
      var actions = el('div', 'moment-actions');
      var edit = el('button', 'btn btn-ghost btn-sm', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', function () { openEditor(m); });
      var del = el('button', 'btn btn-ghost btn-sm is-danger', '删除');
      del.type = 'button';
      del.addEventListener('click', async function () {
        if (!window.confirm('确认删除这条碎碎念？')) return;
        try { await window.BlogApi.deleteMoment(m.id); renderTimeline(true); }
        catch (err) { notice(err.message || '删除失败', 'error'); }
      });
      actions.appendChild(edit);
      actions.appendChild(del);
      card.appendChild(actions);
    }

    if (window.BlogInteractions && typeof window.BlogInteractions.mount === 'function') {
      window.BlogInteractions.mount(card, 'moment', m.id, ctx.state);
    }
    return card;
  }

  function buildComposer() {
    var box = el('div', 'moment-composer');
    var ta = el('textarea', 'text-input moment-composer-input');
    ta.maxLength = 500;
    ta.rows = 3;
    ta.placeholder = '此刻在想什么？最多 500 字。';
    box.appendChild(ta);
    var row = el('div', 'moment-composer-row');
    var count = el('span', 'moment-count', '0 / 500');
    row.appendChild(count);
    ta.addEventListener('input', function () { count.textContent = ta.value.length + ' / 500'; });
    var pin = el('label', 'moment-pin');
    var pinChk = el('input'); pinChk.type = 'checkbox';
    pin.appendChild(pinChk);
    pin.appendChild(el('span', null, '置顶'));
    row.appendChild(pin);
    var send = el('button', 'btn btn-primary btn-sm', '发布');
    send.type = 'button';
    send.addEventListener('click', async function () {
      var content = ta.value.trim();
      if (!content) { notice('写点什么再发布吧', 'error'); return; }
      send.disabled = true;
      try {
        await window.BlogApi.createMoment({
          content: content,
          visibility: 'public',
          pinned: pinChk.checked,
        });
        ta.value = ''; count.textContent = '0 / 500';
        renderTimeline(true);
      } catch (err) { send.disabled = false; notice(err.message || '发布失败', 'error'); }
    });
    row.appendChild(send);
    box.appendChild(row);
    return box;
  }

  function openEditor(m) {
    var box = el('div', 'moment-composer');
    var ta = el('textarea', 'text-input moment-composer-input');
    ta.maxLength = 500; ta.rows = 3; ta.value = m.content || '';
    box.appendChild(ta);
    var row = el('div', 'moment-composer-row');
    var send = el('button', 'btn btn-primary btn-sm', '保存');
    send.type = 'button';
    send.addEventListener('click', async function () {
      var content = ta.value.trim();
      if (!content) { notice('写点什么再保存吧', 'error'); return; }
      send.disabled = true;
      try {
        await window.BlogApi.updateMoment(m.id, { content: content, pinned: !!m.pinned });
        renderTimeline(true);
      } catch (err) { send.disabled = false; notice(err.message || '保存失败', 'error'); }
    });
    var cancel = el('button', 'btn btn-ghost btn-sm', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', function () { renderTimeline(true); });
    row.appendChild(cancel); row.appendChild(send);
    box.appendChild(row);

    root.innerHTML = '';
    root.appendChild(box);
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  function render() {
    renderTimeline(true);
  }

  window.BlogPage = {
    // 空态「记一条」：收起三态面板并聚焦已渲染的发布框
    onCreate: function () {
      ['state-loading', 'state-empty', 'state-error'].forEach(function (id) {
        var n = $(id);
        if (n) n.hidden = true;
      });
      var ta = document.querySelector('.moment-composer-input');
      if (ta) { ta.focus(); ta.scrollIntoView({ block: 'center' }); }
    },
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
      render();
    },
  };
})();
