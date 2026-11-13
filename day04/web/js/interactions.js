'use strict';

/**
 * F8 互动多态组件（P2）：点赞 / 收藏、评论区、分享。
 *
 * 挂载方式：BlogInteractions.mount(container, 'article', targetId, session)
 * 同一套组件挂在 F2 / F3 / F4 / F5 详情页，不改各内容表结构（P10）。
 *
 * 安全：评论内容一律 textContent；不拼接 innerHTML。
 * 审核：站点默认先审后发，发表后提示「等待审核」，仅作者本人可见自己的 pending 评论。
 */
(function () {
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function isGuest(session) {
    return !session || session.guest !== false;
  }

  function mount(container, targetType, targetId, session) {
    if (!container || !targetType || !targetId) return;

    var section = el('section', 'interactions');

    /* ---------- 点赞 / 收藏 ---------- */
    var bar = el('div', 'reaction-bar');
    var likeBtn = el('button', 'reaction-btn');
    likeBtn.type = 'button';
    var likeIcon = el('span', 'reaction-icon', '♥');
    likeIcon.setAttribute('aria-hidden', 'true');
    var likeCount = el('span', 'reaction-count', '0');
    likeBtn.appendChild(likeIcon);
    likeBtn.appendChild(likeCount);
    likeBtn.setAttribute('aria-pressed', 'false');
    bar.appendChild(likeBtn);

    var shareBtn = el('button', 'reaction-btn', '分享');
    shareBtn.type = 'button';
    bar.appendChild(shareBtn);
    section.appendChild(bar);

    var shareOut = el('div', 'share-output');
    shareOut.hidden = true;
    section.appendChild(shareOut);

    function renderReactions(data) {
      var count = data && typeof data.likeCount !== 'undefined' ? data.likeCount : 0;
      likeCount.textContent = String(count);
      var liked = !!(data && data.liked);
      likeBtn.classList.toggle('is-active', liked);
      likeBtn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      likeBtn.setAttribute('aria-label', (liked ? '取消点赞' : '点赞') + '，当前 ' + count + ' 个赞');
    }

    window.BlogApi.getReactions(targetType, targetId).then(function (res) {
      renderReactions(res.data);
    }).catch(function () {
      renderReactions({ likeCount: 0, liked: false });
    });

    likeBtn.addEventListener('click', async function () {
      if (isGuest(session)) {
        window.location.href = 'login.html';
        return;
      }
      likeBtn.disabled = true;
      try {
        var wasActive = likeBtn.classList.contains('is-active');
        var payload = { target_type: targetType, target_id: targetId, type: 'like' };
        var res = wasActive
          ? await window.BlogApi.removeReaction(payload)
          : await window.BlogApi.addReaction(payload);
        renderReactions(res.data);
      } catch (err) {
        likeBtn.setAttribute('title', err.message || '操作失败');
      } finally {
        likeBtn.disabled = false;
      }
    });

    /* ---------- 分享 ---------- */
    shareBtn.addEventListener('click', async function () {
      if (isGuest(session)) {
        window.location.href = 'login.html';
        return;
      }
      shareBtn.disabled = true;
      try {
        var res = await window.BlogApi.createShare({ target_type: targetType, target_id: targetId });
        var url = window.BLOG_CONFIG.API_BASE.replace(/\/api$/, '') + '';
        var path = (res.data && res.data.url) || '';
        var abs = location.origin + location.pathname.replace(/[^/]*$/, '') + path;
        shareOut.innerHTML = '';
        var label = el('p', 'share-label', '分享链接（持链接者无需登录即可阅读）：');
        var input = el('input', 'text-input share-input');
        input.type = 'text';
        input.readOnly = true;
        input.value = abs;
        var copy = el('button', 'btn btn-ghost btn-sm', '复制');
        copy.type = 'button';
        copy.addEventListener('click', function () {
          input.select();
          try {
            document.execCommand('copy');
            copy.textContent = '已复制';
          } catch (err) {
            copy.textContent = '请手动复制';
          }
        });
        shareOut.appendChild(label);
        shareOut.appendChild(input);
        shareOut.appendChild(copy);
        shareOut.hidden = false;
        void url;
      } catch (err) {
        shareOut.innerHTML = '';
        shareOut.appendChild(el('p', 'article-notice is-error', err.message || '生成分享链接失败'));
        shareOut.hidden = false;
      } finally {
        shareBtn.disabled = false;
      }
    });

    /* ---------- 评论区 ---------- */
    var commentSection = el('section', 'comments');
    commentSection.appendChild(el('h2', 'comments-title', '评论'));
    var listBox = el('div', 'comment-list');
    commentSection.appendChild(listBox);
    var statusBox = el('p', 'comments-status', '正在加载评论…');
    commentSection.appendChild(statusBox);

    if (!isGuest(session)) {
      var form = el('form', 'comment-form');
      var textarea = el('textarea', 'text-input comment-input');
      textarea.rows = 3;
      textarea.maxLength = 2000;
      textarea.placeholder = '写下你的想法…（发表后需经审核）';
      textarea.required = true;
      form.appendChild(textarea);
      var submitRow = el('div', 'comment-actions');
      var submit = el('button', 'btn btn-primary btn-sm', '发表评论');
      submit.type = 'submit';
      submitRow.appendChild(submit);
      form.appendChild(submitRow);
      commentSection.appendChild(form);

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var content = textarea.value.trim();
        if (!content) return;
        submit.disabled = true;
        try {
          await window.BlogApi.createComment({
            target_type: targetType,
            target_id: targetId,
            content: content,
          });
          textarea.value = '';
          statusBox.textContent = '评论已提交，审核通过后将公开显示。';
          statusBox.className = 'comments-status is-ok';
        } catch (err) {
          statusBox.textContent = err.message || '评论失败';
          statusBox.className = 'comments-status is-error';
        } finally {
          submit.disabled = false;
        }
      });
    } else {
      var loginHint = el('p', 'comments-login');
      var loginLink = el('a', null, '登录');
      loginLink.href = 'login.html';
      loginHint.appendChild(loginLink);
      loginHint.appendChild(document.createTextNode(' 后即可发表评论。'));
      commentSection.appendChild(loginHint);
    }

    section.appendChild(commentSection);
    container.appendChild(section);

    loadComments();

    async function loadComments() {
      try {
        var res = await window.BlogApi.listComments(targetType, targetId, { page: 1, size: 50 });
        var items = (res.data && res.data.items) || [];
        listBox.innerHTML = '';
        if (!items.length) {
          statusBox.textContent = '还没有评论，来写下第一条吧。';
          statusBox.className = 'comments-status';
          return;
        }
        statusBox.hidden = true;
        items.forEach(function (c) {
          var item = el('article', 'comment-item');
          var head = el('div', 'comment-head');
          head.appendChild(el('strong', 'comment-author', c.authorName || '匿名'));
          head.appendChild(el('span', 'comment-time', fmtTime(c.createdAtMs)));
          if (c.status && c.status !== 'approved') {
            head.appendChild(el('span', 'badge badge-draft',
              c.status === 'pending' ? '待审核' : '未通过'));
          }
          item.appendChild(head);
          var body = el('p', 'comment-body', c.content);
          item.appendChild(body);

          var me = !isGuest(session) && session.user && session.user.id;
          if (me && (me === c.authorId)) {
            var delBtn = el('button', 'comment-del', '删除');
            delBtn.type = 'button';
            delBtn.addEventListener('click', async function () {
              delBtn.disabled = true;
              try {
                await window.BlogApi.deleteComment(c.id);
                item.remove();
              } catch (err) {
                delBtn.disabled = false;
              }
            });
            item.appendChild(delBtn);
          }
          listBox.appendChild(item);
        });
      } catch (err) {
        statusBox.textContent = '评论加载失败。';
        statusBox.className = 'comments-status is-error';
      }
    }
  }

  window.BlogInteractions = { mount: mount };
})();
