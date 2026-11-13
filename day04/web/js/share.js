'use strict';

/**
 * F8 分享只读页（P3）：持有效 token 即可匿名只读查看，无需登录；
 * 页面不被搜索引擎索引（meta noindex 在 share.html 静态声明）。
 * 仅展示已净化的公开内容，不暴露任何私有字段。
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
  function showContent(show) { if (root) root.hidden = !show; }
  function fail(message) {
    var errText = $('shell-error-text');
    if (errText) errText.textContent = message || '内容加载失败。';
    ctx.setState('error'); showContent(false);
  }

  function readToken() {
    var params = new URLSearchParams(location.search);
    var t = params.get('token');
    if (t) return t;
    var m = (location.pathname || '').match(/\/s\/([^/?#]+)/);
    if (m) return m[1];
    var h = (location.hash || '').match(/s\/([^/?#]+)/);
    if (h) return h[1];
    return null;
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderMedia(content) {
    var art = el('article', 'media-detail');
    art.appendChild(el('h1', 'article-detail-title', content.title || '无题'));
    var meta = el('div', 'article-detail-meta');
    if (content.type) meta.appendChild(el('span', null, content.type));
    if (content.year) meta.appendChild(el('span', null, String(content.year)));
    art.appendChild(meta);
    if (content.note) art.appendChild(el('p', 'media-note', content.note));
    var disc = el('p', 'media-disclaimer');
    disc.textContent = '本站仅保存并展示外链文本，不存储、不托管、不转存任何文件本体。';
    art.appendChild(disc);
    if (content.externalUrl) {
      art.appendChild(el('p', 'media-link-text', content.externalUrl));
    }
    return art;
  }

  function renderCollection(content) {
    var wrap = el('div', 'share-collection');
    wrap.appendChild(el('h1', 'article-detail-title', content.name || '未命名')); // 已剔除 sharePassword
    if (content.description) wrap.appendChild(el('p', 'article-detail-meta', content.description));
    var items = content.items || [];
    wrap.appendChild(el('p', 'vault-card-meta', items.length + ' 条'));
    var list = el('div', 'vault-items');
    items.forEach(function (it) {
      var row = el('div', 'vault-item');
      row.appendChild(el('span', 'vault-item-title', it.title || '未命名'));
      if (it.type === 'url' && it.url) row.appendChild(el('span', 'vault-item-url', it.url));
      if (it.note) row.appendChild(el('p', 'vault-item-note', it.note));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderMoment(content) {
    var card = el('article', 'moment-card');
    card.appendChild(el('p', 'moment-content', content.content || ''));
    if (content.createdAtMs) card.appendChild(el('span', 'moment-time', fmtTime(content.createdAtMs)));
    return card;
  }

  function renderArticle(content) {
    var art = el('article', 'article-detail');
    art.appendChild(el('h1', 'article-detail-title', content.title || '无题'));
    // 文章正文：唯一允许的 innerHTML，服务端已按白名单净化
    var body = el('div', 'article-body markdown-body');
    body.innerHTML = content.contentHtml || '<p>（暂无正文）</p>';
    art.appendChild(body);
    return art;
  }

  async function render() {
    var token = readToken();
    if (!token) { fail('分享链接缺少 token。'); return; }
    load(token, null);
  }

  async function load(token, password) {
    ctx.setState('loading');
    showContent(false);
    var res;
    try {
      res = await window.BlogApi.getShare(token, password);
    } catch (err) {
      if (err && err.status === 403) {
        // 该公开集合设有访问口令，要求输入
        renderPasswordPrompt(token);
        return;
      }
      fail(err && err.status === 404 ? '分享链接不存在或已失效。' : (err && err.message) || '内容加载失败。');
      return;
    }
    var data = res && res.data;
    if (!data) { fail('分享内容为空或已失效。'); return; }
    var content = data.content || {};
    var type = data.targetType;

    root.innerHTML = '';
    var back = el('a', 'btn btn-ghost btn-sm', '← 返回主页');
    back.href = 'home.html';
    root.appendChild(back);

    if (type === 'media') root.appendChild(renderMedia(content));
    else if (type === 'collection') root.appendChild(renderCollection(content));
    else if (type === 'moment') root.appendChild(renderMoment(content));
    else if (type === 'article') root.appendChild(renderArticle(content));
    else root.appendChild(el('p', null, '暂不支持的分享类型。'));

    if (window.BlogInteractions && typeof window.BlogInteractions.mount === 'function' && content.id) {
      window.BlogInteractions.mount(root, type, content.id, ctx.state);
    }
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  function renderPasswordPrompt(token) {
    root.innerHTML = '';
    var box = el('div', 'share-password-box');
    box.appendChild(el('h2', 'section-title', '该内容需要访问口令'));
    box.appendChild(el('p', 'section-sub', '请输入分享者提供的访问口令。'));
    var form = el('form', 'editor-form');
    var input = el('input', 'text-input');
    input.type = 'password';
    input.placeholder = '访问口令';
    input.maxLength = 64;
    form.appendChild(input);
    var actions = el('div', 'editor-actions');
    var submit = el('button', 'btn btn-primary', '查看'); submit.type = 'submit';
    actions.appendChild(submit);
    form.appendChild(actions);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = input.value || '';
      if (!pw) return;
      load(token, pw);
    });
    box.appendChild(form);
    root.appendChild(box);
    showContent(true);
  }

  window.BlogPage = {
    // 「返回主页」是本页唯一的主操作
    onCreate: function () { location.href = 'home.html'; },
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
