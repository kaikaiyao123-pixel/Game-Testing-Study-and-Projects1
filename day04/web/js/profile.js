'use strict';

/**
 * F6 个人资料页（P2）。
 *
 * 访客：跳转登录（资料编辑属于写操作页，公共只读资料走 /api/profile/{id}，
 *       本期页面主体面向本人）。
 * 登录：展示头像 / 昵称 / 脱敏手机号 / 简介 / 注册时间，并支持编辑昵称与简介、
 *       上传头像（服务端重采样 320×320，限制 2 MB 与图片类型）。
 *
 * 手机号是登录凭据，本期只读脱敏展示，不开放修改（§F6）。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var ctx = { state: { guest: true }, setState: function () {} };
  var root;

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function notice(message, kind) {
    var box = $('profile-notice');
    if (!box) {
      box = el('p', 'article-notice');
      box.id = 'profile-notice';
      box.setAttribute('role', 'status');
      if (root) root.insertBefore(box, root.firstChild);
    }
    if (!box) return;
    box.textContent = message;
    box.className = 'article-notice' + (kind === 'error' ? ' is-error' : '');
    box.hidden = false;
  }

  function hideStates() {
    ['state-loading', 'state-empty', 'state-error'].forEach(function (id) {
      var n = $(id);
      if (n) n.hidden = true;
    });
  }

  async function render() {
    if (!ctx.state || ctx.state.guest !== false) {
      ctx.setState('loading');
      ctx.setState('empty');
      var hint = $('shell-empty-hint');
      if (hint) hint.textContent = '登录后即可查看与编辑个人资料。';
      return;
    }

    var res;
    try {
      res = await window.BlogApi.getProfile();
    } catch (err) {
      var errText = $('shell-error-text');
      if (errText) errText.textContent = err.message || '资料加载失败。';
      ctx.setState('error');
      return;
    }
    var p = (res && res.data) || {};

    root.innerHTML = '';
    hideStates();
    root.hidden = false;

    var card = el('section', 'profile-card');

    /* ---- 头部：头像 + 身份 ---- */
    var header = el('div', 'profile-head');
    var avatarWrap = el('div', 'profile-avatar-wrap');
    var avatar = el('img', 'profile-avatar');
    avatar.src = p.avatarUrl ? absoluteUrl(p.avatarUrl) : 'assets/head.png';
    avatar.alt = (p.nickname || '用户') + ' 的头像';
    avatarWrap.appendChild(avatar);
    header.appendChild(avatarWrap);

    var identity = el('div', 'profile-identity');
    identity.appendChild(el('h2', 'profile-name', p.nickname || '未命名'));
    identity.appendChild(el('p', 'profile-phone', '手机号 ' + (p.phoneMasked || '—')));
    identity.appendChild(el('p', 'profile-since', '加入于 ' + fmtDate(p.createdAtMs)));
    header.appendChild(identity);
    card.appendChild(header);

    /* ---- 简介 ---- */
    var bioBlock = el('div', 'profile-bio');
    bioBlock.appendChild(el('h3', 'profile-subtitle', '简介'));
    bioBlock.appendChild(el('p', 'profile-bio-text', p.bio || '还没有写简介。'));
    card.appendChild(bioBlock);

    /* ---- 编辑表单 ---- */
    var form = el('form', 'profile-form');
    form.setAttribute('novalidate', 'novalidate');
    form.appendChild(el('h3', 'profile-subtitle', '编辑资料'));

    var nameField = el('div', 'field');
    var nameLabel = el('label', 'field-label', '昵称');
    nameLabel.htmlFor = 'pf-nickname';
    var nameInput = el('input', 'text-input');
    nameInput.id = 'pf-nickname';
    nameInput.type = 'text';
    nameInput.maxLength = 24;
    nameInput.value = p.nickname || '';
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    nameField.appendChild(el('p', 'field-hint', '1~24 位，仅含字母、数字、空格、_ . -'));
    form.appendChild(nameField);

    var bioField = el('div', 'field');
    var bioLabel = el('label', 'field-label', '简介');
    bioLabel.htmlFor = 'pf-bio';
    var bioInput = el('textarea', 'text-input');
    bioInput.id = 'pf-bio';
    bioInput.rows = 4;
    bioInput.maxLength = 500;
    bioInput.value = p.bio || '';
    bioField.appendChild(bioLabel);
    bioField.appendChild(bioInput);
    bioField.appendChild(el('p', 'field-hint', '不超过 500 字'));
    form.appendChild(bioField);

    var actions = el('div', 'editor-actions');
    var saveBtn = el('button', 'btn btn-primary', '保存资料');
    saveBtn.type = 'submit';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      saveBtn.disabled = true;
      try {
        var out = await window.BlogApi.updateProfile({
          nickname: nameInput.value.trim(),
          bio: bioInput.value,
        });
        notice('资料已保存。', 'ok');
        // 同步顶栏昵称
        if (window.BlogSite && ctx.state) {
          ctx.state.user = ctx.state.user || {};
          ctx.state.user.nickname = out.data.nickname;
          window.BlogSite.renderSession(ctx.state);
        }
      } catch (err) {
        notice(err.message || '保存失败', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });
    card.appendChild(form);

    /* ---- 头像上传 ---- */
    var avatarBlock = el('div', 'profile-avatar-upload');
    avatarBlock.appendChild(el('h3', 'profile-subtitle', '更换头像'));
    var fileInput = el('input', 'file-input');
    fileInput.id = 'pf-avatar';
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
    var fileLabel = el('label', 'btn btn-ghost btn-sm', '选择图片');
    fileLabel.htmlFor = 'pf-avatar';
    avatarBlock.appendChild(fileLabel);
    avatarBlock.appendChild(fileInput);
    avatarBlock.appendChild(el('p', 'field-hint', '支持 jpg / png / webp / gif，不超过 2 MB，将自动裁切为 320×320。'));

    fileInput.addEventListener('change', async function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        notice('头像不超过 2 MB', 'error');
        return;
      }
      fileLabel.classList.add('is-busy');
      try {
        var out = await window.BlogApi.uploadAvatar(file);
        var url = out.data && out.data.avatarUrl;
        if (url) {
          avatar.src = absoluteUrl(url) + '?t=' + Date.now();
        }
        notice('头像已更新。', 'ok');
      } catch (err) {
        notice(err.message || '头像上传失败', 'error');
      } finally {
        fileLabel.classList.remove('is-busy');
        fileInput.value = '';
      }
    });
    card.appendChild(avatarBlock);

    // 提示条由 profile.html 静态声明（#profile-notice），notice() 复用同一节点。
    root.appendChild(card);
  }

  /** 上传类 URL 由 8081 提供，前端需拼接 API_BASE。 */
  function absoluteUrl(url) {
    if (!url) return '';
    if (/^https?:\/\//.test(url)) return url;
    var base = (window.BLOG_CONFIG && window.BLOG_CONFIG.API_BASE) || '';
    return base + url;
  }

  window.BlogPage = {
    // 「编辑资料」：收起空态并聚焦昵称输入
    onCreate: function () {
      hideStates();
      var first = document.querySelector('#content-root input');
      if (first) first.focus();
    },
    init: function (context) {
      ctx = context || ctx;
      root = $('content-root');
      if (!root) {
        ctx.setState('empty');
        return;
      }
      render();
    },
  };
})();
