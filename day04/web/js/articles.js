'use strict';

/**
 * F2 文章模块（P2）：列表 / 详情 / 编辑器 / 删除。
 *
 * 安全约定（§5.8）：所有用户文本一律 textContent 输出；唯一的 innerHTML
 * 来源是服务端已净化的 contentHtml（MarkdownUtil + HtmlSanitizer 双重白名单）。
 * 前端不做 Markdown 渲染，避免「预览用前端、正文用后端」两套规则不一致。
 *
 * 视图由 location.hash 驱动：#/、#/new、#/edit/<id>、#/p/<id>
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var ctx = { state: { guest: true }, setState: function () {} };
  var root;
  var categories = [];
  var tags = [];

  /* ---------------- 工具 ---------------- */

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

  function isGuest() {
    return !ctx.state || ctx.state.guest !== false;
  }

  function currentUser() {
    return (ctx.state && ctx.state.user) || {};
  }

  function showContent(show) {
    if (root) root.hidden = !show;
  }

  function fail(message) {
    var errText = $('shell-error-text');
    if (errText) errText.textContent = message || '内容加载失败，请稍后重试。';
    ctx.setState('error');
    showContent(false);
  }

  /** 统一错误提示条（role=status），不弹窗打断阅读。 */
  function notice(message, kind) {
    if (!root) return;
    var box = $('article-notice');
    if (!box) {
      box = el('p', 'article-notice');
      box.id = 'article-notice';
      box.setAttribute('role', 'status');
      root.insertBefore(box, root.firstChild);
    }
    box.textContent = message;
    box.className = 'article-notice' + (kind === 'error' ? ' is-error' : '');
    box.hidden = false;
  }

  /* ---------------- 路由 ---------------- */

  function parseRoute() {
    var hash = (location.hash || '').replace(/^#\/?/, '');
    if (hash === 'new') return { name: 'editor', id: null };
    if (hash.indexOf('edit/') === 0) return { name: 'editor', id: hash.slice(5) };
    if (hash.indexOf('p/') === 0) return { name: 'detail', id: hash.slice(2) };
    return { name: 'list' };
  }

  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  /* ---------------- 列表 ---------------- */

  async function renderList() {
    ctx.setState('loading');
    showContent(false);
    var res;
    try {
      res = await window.BlogApi.listArticles({ page: 1, size: 20 });
    } catch (err) {
      fail(err && err.message ? err.message : '文章列表加载失败。');
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
    headText.appendChild(el('h2', 'section-title', '全部文章'));
    headText.appendChild(el('p', 'section-sub',
      '共 ' + (data.total || items.length) + ' 篇 · 按发布时间倒序'));
    head.appendChild(headText);
    if (!isGuest()) {
      var write = el('button', 'btn btn-primary', '写文章');
      write.type = 'button';
      write.addEventListener('click', function () { navigate('#/new'); });
      head.appendChild(write);
    }
    root.appendChild(head);

    var grid = el('div', 'article-grid');
    items.forEach(function (a) {
      var card = el('article', 'article-card');
      var title = el('h3', 'article-card-title');
      var link = el('a', null, a.title || '无题');
      link.href = '#/p/' + a.id;
      title.appendChild(link);
      card.appendChild(title);
      card.appendChild(el('p', 'article-card-summary', a.summary || '（无摘要）'));
      var meta = el('div', 'article-card-meta');
      meta.appendChild(el('span', null, a.authorName || '匿名'));
      meta.appendChild(el('span', null, fmtTime(a.publishedAtMs || a.createdAtMs)));
      meta.appendChild(el('span', null, '阅读 ' + (a.viewCount || 0)));
      card.appendChild(meta);
      grid.appendChild(card);
    });
    root.appendChild(grid);
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  /* ---------------- 详情 ---------------- */

  async function renderDetail(id) {
    ctx.setState('loading');
    showContent(false);
    var res;
    try {
      res = await window.BlogApi.getArticle(id);
    } catch (err) {
      fail(err && err.status === 404 ? '文章不存在或已删除。' : (err && err.message));
      return;
    }
    var a = (res && res.data) || {};
    root.innerHTML = '';

    var article = el('article', 'article-detail');
    var bar = el('div', 'article-detail-bar');
    var back = el('a', 'btn btn-ghost btn-sm', '← 返回列表');
    back.href = '#/';
    bar.appendChild(back);
    if (!isGuest() && currentUser().id === a.authorId) {
      var edit = el('button', 'btn btn-ghost btn-sm', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', function () { navigate('#/edit/' + a.id); });
      bar.appendChild(edit);
      var del = el('button', 'btn btn-ghost btn-sm is-danger', '删除');
      del.type = 'button';
      del.addEventListener('click', async function () {
        if (!window.confirm('确认删除这篇文章？删除后不再出现在列表中。')) return;
        del.disabled = true;
        try {
          await window.BlogApi.deleteArticle(a.id);
          navigate('#/');
        } catch (err) {
          del.disabled = false;
          notice(err.message || '删除失败', 'error');
        }
      });
      bar.appendChild(del);
    }
    article.appendChild(bar);

    article.appendChild(el('h1', 'article-detail-title', a.title || '无题'));
    var meta = el('div', 'article-detail-meta');
    meta.appendChild(el('span', null, a.authorName || '匿名'));
    meta.appendChild(el('span', null, fmtTime(a.publishedAtMs || a.createdAtMs)));
    meta.appendChild(el('span', null, '阅读 ' + (a.viewCount || 0)));
    if (a.status && a.status !== 'published') {
      meta.appendChild(el('span', 'badge badge-draft', a.status === 'draft' ? '草稿' : '已归档'));
    }
    article.appendChild(meta);

    // 唯一的 innerHTML：服务端已按白名单净化（MarkdownUtil → HtmlSanitizer）
    var body = el('div', 'article-body markdown-body');
    body.innerHTML = a.contentHtml || '<p>（暂无正文）</p>';
    article.appendChild(body);

    root.appendChild(article);
    showContent(true);
    ctx.setState('loading', 'hide-all');
    window.BlogInteractions.mount(article, 'article', a.id, ctx.state);
  }

  /* ---------------- 编辑器 ---------------- */

  async function renderEditor(id) {
    if (isGuest()) {
      ctx.setState('loading');
      showContent(false);
      ctx.setState('empty');
      var hint = $('shell-empty-hint');
      if (hint) hint.textContent = '写文章需要先登录。登录后回到本页即可开始写作。';
      return;
    }

    var existing = null;
    if (id) {
      try {
        var res = await window.BlogApi.getArticle(id);
        existing = res.data;
      } catch (err) {
        fail('要编辑的文章不存在。');
        return;
      }
    }

    try {
      var cRes = await window.BlogApi.listCategories();
      categories = cRes.data || [];
    } catch (err) {
      categories = [];
    }

    ctx.setState('loading');
    root.innerHTML = '';

    var form = el('form', 'editor-form');
    form.setAttribute('novalidate', 'novalidate');

    var titleField = el('div', 'field');
    titleField.appendChild(label('文章标题', 'ed-title'));
    var titleInput = el('input', 'text-input');
    titleInput.id = 'ed-title';
    titleInput.type = 'text';
    titleInput.maxLength = 200;
    titleInput.required = true;
    titleInput.value = existing ? existing.title : '';
    titleInput.placeholder = '给这篇文章起个标题';
    titleField.appendChild(titleInput);
    form.appendChild(titleField);

    var optRow = el('div', 'editor-row');
    var catField = el('div', 'field');
    catField.appendChild(label('分类（可选）', 'ed-category'));
    var catSelect = el('select', 'text-input');
    catSelect.id = 'ed-category';
    var emptyOpt = el('option', null, '未分类');
    emptyOpt.value = '';
    catSelect.appendChild(emptyOpt);
    categories.forEach(function (c) {
      var o = el('option', null, c.name);
      o.value = c.id;
      catSelect.appendChild(o);
    });
    if (existing && existing.categoryId) catSelect.value = existing.categoryId;
    catField.appendChild(catSelect);
    optRow.appendChild(catField);

    var visField = el('div', 'field');
    visField.appendChild(label('可见性', 'ed-visibility'));
    var visSelect = el('select', 'text-input');
    visSelect.id = 'ed-visibility';
    [['public', '公开（匿名可读）'], ['private', '私有（仅自己）']].forEach(function (p) {
      var o = el('option', null, p[1]);
      o.value = p[0];
      visSelect.appendChild(o);
    });
    visSelect.value = (existing && existing.visibility) || 'public';
    visField.appendChild(visSelect);
    optRow.appendChild(visField);
    form.appendChild(optRow);

    var tagField = el('div', 'field');
    tagField.appendChild(label('标签（逗号分隔）', 'ed-tags'));
    var tagInput = el('input', 'text-input');
    tagInput.id = 'ed-tags';
    tagInput.type = 'text';
    tagInput.placeholder = '随笔, 技术';
    tagField.appendChild(tagInput);
    form.appendChild(tagField);

    var mdField = el('div', 'field');
    mdField.appendChild(label('正文（Markdown）', 'ed-content'));
    var mdInput = el('textarea', 'text-input editor-textarea');
    mdInput.id = 'ed-content';
    mdInput.rows = 16;
    mdInput.placeholder = '# 标题\n\n支持 **加粗**、*斜体*、`代码`、列表、引用与链接。';
    mdInput.value = existing ? (existing.contentMd || '') : '';
    mdField.appendChild(mdInput);
    mdField.appendChild(el('p', 'field-hint',
      '原始 HTML 会被转义，正文渲染与净化均在服务端完成。'));
    form.appendChild(mdField);

    var preview = el('div', 'article-body markdown-body editor-preview');
    preview.id = 'ed-preview';
    preview.hidden = true;
    form.appendChild(preview);

    var actions = el('div', 'editor-actions');
    var previewBtn = el('button', 'btn btn-ghost', '预览');
    previewBtn.type = 'button';
    var draftBtn = el('button', 'btn btn-ghost', '存为草稿');
    draftBtn.type = 'button';
    var publishBtn = el('button', 'btn btn-primary', existing && existing.status === 'published' ? '更新' : '发布');
    publishBtn.type = 'submit';
    actions.appendChild(previewBtn);
    actions.appendChild(draftBtn);
    actions.appendChild(publishBtn);
    form.appendChild(actions);

    // 提示条由 articles.html 静态声明（#article-notice），notice() 复用同一节点，
    // 此处不再另建，避免同一页面出现重复 id。
    previewBtn.addEventListener('click', async function () {
      if (!preview.hidden) {
        preview.hidden = true;
        previewBtn.textContent = '预览';
        return;
      }
      previewBtn.disabled = true;
      try {
        var r = await window.BlogApi.previewMarkdown(mdInput.value);
        // 服务端净化后的 HTML
        preview.innerHTML = (r.data && r.data.html) || '<p>（无内容）</p>';
        preview.hidden = false;
        previewBtn.textContent = '收起预览';
      } catch (err) {
        notice(err.message || '预览失败', 'error');
      } finally {
        previewBtn.disabled = false;
      }
    });

    async function save(status) {
      var title = titleInput.value.trim();
      if (!title) {
        notice('请先填写标题', 'error');
        titleInput.focus();
        return;
      }
      var payload = {
        title: title,
        content_md: mdInput.value,
        status: status,
        visibility: visSelect.value,
        category_id: catSelect.value || null,
        tags: tagInput.value.split(/[,，]/).map(function (s) { return s.trim(); })
          .filter(function (s) { return s; }),
      };
      draftBtn.disabled = true;
      publishBtn.disabled = true;
      try {
        var out = existing
          ? await window.BlogApi.updateArticle(existing.id, payload)
          : await window.BlogApi.createArticle(payload);
        navigate('#/p/' + out.data.id);
      } catch (err) {
        notice(err.message || '保存失败', 'error');
        draftBtn.disabled = false;
        publishBtn.disabled = false;
      }
    }

    draftBtn.addEventListener('click', function () { save('draft'); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      save('published');
    });

    root.appendChild(form);
    showContent(true);
    ctx.setState('loading', 'hide-all');
    titleInput.focus();
  }

  function label(text, forId) {
    var l = el('label', 'field-label', text);
    l.htmlFor = forId;
    return l;
  }

  /* ---------------- 分发 ---------------- */

  async function render() {
    var route = parseRoute();
    if (route.name === 'detail') return renderDetail(route.id);
    if (route.name === 'editor') return renderEditor(route.id);
    return renderList();
  }

  window.BlogPage = {
    // 空态「写文章」与列表头按钮共用同一条 hash 路由
    onCreate: function () { navigate('#/new'); },
    init: function (context) {
      ctx = context || ctx;
      root = $('content-root');
      if (!root) {
        ctx.setState('empty');
        return;
      }
      // 让 setState('loading','hide-all') 能收起三个状态面板
      var origSetState = ctx.setState;
      ctx.setState = function (name, mode) {
        if (mode === 'hide-all') {
          ['state-loading', 'state-empty', 'state-error'].forEach(function (id) {
            var node = $(id);
            if (node) node.hidden = true;
          });
          return;
        }
        origSetState(name);
      };
      window.addEventListener('hashchange', render);
      render();
    },
  };
})();
