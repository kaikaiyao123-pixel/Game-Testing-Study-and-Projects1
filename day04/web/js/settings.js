'use strict';

/**
 * F7 账号设置（P3）：安全（改密 / 会话 / 登录记录）、偏好、危险操作三个分区。
 * 安全分区需要登录；偏好按 user_id 隔离不串号；危险操作二次确认。
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
  function showContent(show) { if (root) root.hidden = !show; }
  function fail(message) {
    var errText = $('shell-error-text');
    if (errText) errText.textContent = message || '加载失败，请稍后重试。';
    ctx.setState('error'); showContent(false);
  }
  function notice(message, kind) {
    if (!root) return;
    var box = $('settings-notice') || $('article-notice');
    if (!box) {
      box = el('p', 'article-notice'); box.id = 'settings-notice';
      box.setAttribute('role', 'status'); root.insertBefore(box, root.firstChild);
    }
    box.textContent = message;
    box.className = 'article-notice' + (kind === 'error' ? ' is-error' : '');
    box.hidden = false;
  }

  function section(title, desc) {
    var sec = el('section', 'settings-section');
    sec.appendChild(el('h2', 'settings-section-title', title));
    if (desc) sec.appendChild(el('p', 'settings-section-desc', desc));
    return sec;
  }
  function field(labelText, control) {
    var f = el('div', 'field');
    f.appendChild(el('label', 'field-label', labelText));
    f.appendChild(control);
    return f;
  }
  function input(type, value, placeholder, max) {
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
  function button(label, cls) {
    var b = el('button', cls || 'btn btn-primary', label);
    b.type = 'button';
    return b;
  }

  /* ---------------- 安全分区 ---------------- */

  function buildSecurity() {
    var sec = section('安全', '改密后其他登录设备会立即退出；可在此查看并管理当前会话与登录记录。');

    // 改密
    var pwdForm = el('form', 'editor-form');
    pwdForm.setAttribute('novalidate', 'novalidate');
    pwdForm.appendChild(field('当前密码', input('password')));
    pwdForm.appendChild(field('新密码（8~16 位）', input('password')));
    pwdForm.appendChild(field('确认新密码', input('password')));
    var savePwd = button('修改密码');
    savePwd.addEventListener('click', async function () {
      var old = pwdForm.querySelectorAll('.text-input')[0].value;
      var np = pwdForm.querySelectorAll('.text-input')[1].value;
      var np2 = pwdForm.querySelectorAll('.text-input')[2].value;
      if (np !== np2) { notice('两次输入的新密码不一致', 'error'); return; }
      savePwd.disabled = true;
      try {
        await window.BlogApi.changePassword({ oldPassword: old, newPassword: np });
        notice('密码已修改，其他设备已退出');
        pwdForm.reset();
      } catch (err) { savePwd.disabled = false; notice(err.message || '修改失败', 'error'); }
    });
    pwdForm.appendChild(savePwd);
    sec.appendChild(pwdForm);

    // 会话列表
    var sessWrap = el('div', 'settings-block');
    sessWrap.appendChild(el('h3', 'settings-subtitle', '登录会话'));
    var sessList = el('div', 'session-list'); sessList.id = 'session-list';
    sessWrap.appendChild(sessList);
    var logoutOthers = button('退出其他设备', 'btn btn-ghost');
    logoutOthers.addEventListener('click', async function () {
      try { await window.BlogApi.revokeOtherSessions(); notice('已退出其他设备'); loadSessions(sessList); }
      catch (err) { notice(err.message || '操作失败', 'error'); }
    });
    sessWrap.appendChild(logoutOthers);
    sec.appendChild(sessWrap);

    // 登录记录
    var logWrap = el('div', 'settings-block');
    logWrap.appendChild(el('h3', 'settings-subtitle', '近期登录记录'));
    var logList = el('div', 'login-log-list'); logList.id = 'login-log-list';
    logWrap.appendChild(logList);
    sec.appendChild(logWrap);

    loadSessions(sessList);
    loadLogs(logList);
    return sec;
  }

  async function loadSessions(listEl) {
    try {
      var res = await window.BlogApi.listSessions();
      var items = (res.data && res.data.items) || [];
      listEl.innerHTML = '';
      if (!items.length) { listEl.appendChild(el('p', 'settings-empty', '暂无会话')); return; }
      items.forEach(function (s) {
        var row = el('div', 'session-row');
        row.appendChild(el('span', 'session-ua', s.userAgent || '未知设备'));
        row.appendChild(el('span', 'session-ip', s.ip || ''));
        row.appendChild(el('span', 'session-time', (s.current ? '当前会话' : '登录于 ' + (s.createdAt || '').slice(0, 16))));
        if (!s.current) {
          var revoke = button('踢下线', 'btn btn-ghost btn-sm is-danger');
          revoke.addEventListener('click', async function () {
            try { await window.BlogApi.revokeSession(s.token); loadSessions(listEl); }
            catch (err) { notice(err.message || '操作失败', 'error'); }
          });
          row.appendChild(revoke);
        }
        listEl.appendChild(row);
      });
    } catch (err) { listEl.innerHTML = ''; listEl.appendChild(el('p', 'settings-empty', '会话加载失败')); }
  }

  async function loadLogs(listEl) {
    try {
      var res = await window.BlogApi.loginLogs({ page: 1, size: 20 });
      var items = (res.data && res.data.items) || [];
      listEl.innerHTML = '';
      if (!items.length) { listEl.appendChild(el('p', 'settings-empty', '暂无登录记录')); return; }
      items.forEach(function (l) {
        var row = el('div', 'login-log-row');
        row.appendChild(el('span', 'login-log-result', l.result === 'success' ? '成功' : '失败'));
        row.appendChild(el('span', null, l.ip || ''));
        row.appendChild(el('span', null, (l.createdAt || '').slice(0, 16)));
        if (l.reason) row.appendChild(el('span', 'login-log-reason', l.reason));
        listEl.appendChild(row);
      });
    } catch (err) { listEl.innerHTML = ''; listEl.appendChild(el('p', 'settings-empty', '记录加载失败')); }
  }

  /* ---------------- 偏好分区 ---------------- */

  function buildPreferences(prefs) {
    var sec = section('偏好', '显示名、默认可见性、每页条数、背景模式与评论审核开关。');
    var form = el('form', 'editor-form');
    form.setAttribute('novalidate', 'novalidate');
    var p = prefs || {};
    form.appendChild(field('显示名（1~40 字）', input('text', p.siteName || '', '', 40)));
    form.appendChild(field('默认可见性', selectEl([['public', '公开'], ['private', '私有']], p.defaultVisibility || 'public')));
    form.appendChild(field('每页条数（5~100）', input('number', p.pageSize || 20)));
    form.appendChild(field('背景模式', selectEl([['warm', '暖色'], ['cool', '冷色'], ['dark', '暗色']], p.backgroundMode || 'warm')));
    var modWrap = el('label', 'field check-field');
    var mod = el('input'); mod.type = 'checkbox'; if (p.commentModeration) mod.checked = true;
    modWrap.appendChild(mod);
    modWrap.appendChild(el('span', null, '开启评论审核（新评论默认待审）'));
    form.appendChild(modWrap);

    var save = button('保存偏好');
    save.addEventListener('click', async function () {
      var payload = {
        siteName: form.querySelectorAll('.text-input')[0].value.trim() || null,
        defaultVisibility: form.querySelectorAll('select')[0].value,
        pageSize: Number(form.querySelectorAll('.text-input')[1].value) || 20,
        backgroundMode: form.querySelectorAll('select')[1].value,
        commentModeration: mod.checked,
      };
      save.disabled = true;
      try {
        await window.BlogApi.updatePreferences(payload);
        notice('偏好已保存');
      } catch (err) { save.disabled = false; notice(err.message || '保存失败', 'error'); }
      finally { save.disabled = false; }
    });
    form.appendChild(save);
    sec.appendChild(form);
    return sec;
  }

  /* ---------------- 危险操作 ---------------- */

  function buildDanger() {
    var sec = section('危险操作', '注销为软删除并保留内容以便恢复；导出可用于本地存档。');
    var wrap = el('div', 'settings-block');
    var exportBtn = button('导出我的数据', 'btn btn-ghost');
    exportBtn.addEventListener('click', async function () {
      try {
        var res = await window.BlogApi.exportData();
        var data = (res.data) || {};
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'my-data.json';
        a.click();
        URL.revokeObjectURL(a.href);
        notice('数据已导出');
      } catch (err) { notice(err.message || '导出失败', 'error'); }
    });
    wrap.appendChild(exportBtn);

    var delBtn = button('注销账号', 'btn btn-ghost is-danger');
    delBtn.addEventListener('click', async function () {
      if (!window.confirm('注销后账号将被停用且内容保留以便恢复，确认注销？')) return;
      try {
        await window.BlogApi.deleteAccount();
        window.BlogAuthStore.clearToken();
        window.location.href = 'home.html';
      } catch (err) { notice(err.message || '注销失败', 'error'); }
    });
    wrap.appendChild(delBtn);
    sec.appendChild(wrap);
    return sec;
  }

  /* ---------------- 分发 ---------------- */

  async function render() {
    if (isGuest()) {
      ctx.setState('empty');
      var hint = $('shell-empty-hint');
      if (hint) hint.textContent = '账号设置需要先登录。';
      showContent(false);
      return;
    }
    ctx.setState('loading');
    showContent(false);
    var prefs = {};
    try { var r = await window.BlogApi.getPreferences(); prefs = (r.data) || {}; }
    catch (err) { prefs = {}; }

    root.innerHTML = '';
    root.appendChild(buildSecurity());
    root.appendChild(buildPreferences(prefs));
    root.appendChild(buildDanger());
    showContent(true);
    ctx.setState('loading', 'hide-all');
  }

  window.BlogPage = {
    // 「前往设置」：收起空态并聚焦第一个设置项
    onCreate: function () {
      var first = document.querySelector('#content-root input');
      if (first) { showContent(true); ctx.setState('loading', 'hide-all'); first.focus(); }
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
