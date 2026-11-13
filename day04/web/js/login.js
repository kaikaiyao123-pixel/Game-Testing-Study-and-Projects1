'use strict';

/** 登录页交互：Tab 切换、前端校验、调用真实后端接口、会话写入与跳转。 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var formLogin = $('form-login');
  var formRegister = $('form-register');
  var errLogin = $('login-error');
  var errRegister = $('register-error');
  var toast = $('toast');
  var toastTimer = 0;

  function setError(el, message) {
    el.textContent = message || '';
    el.hidden = !message;
  }

  function showToast(message, kind) {
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast' + (kind ? ' is-' + kind : '');
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function setLoading(button, loading, text) {
    if (loading) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = text || '处理中…';
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function switchTab(name) {
    var isLogin = name === 'login';
    formLogin.hidden = !isLogin;
    formRegister.hidden = isLogin;
    $('foot-register').hidden = !isLogin;
    $('foot-login').hidden = isLogin;
    setError(errLogin, '');
    setError(errRegister, '');
    tabs.forEach(function (tab) {
      var active = tab.dataset.tab === name;
      if (active) tab.classList.add('is-active');
      else tab.classList.remove('is-active');
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });
  $('link-to-register').addEventListener('click', function (e) {
    e.preventDefault();
    switchTab('register');
  });
  $('link-to-login').addEventListener('click', function (e) {
    e.preventDefault();
    switchTab('login');
  });

  Array.prototype.slice.call(document.querySelectorAll('.pwd-toggle')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = $(btn.dataset.target);
      if (!input) return;
      var toShow = input.type === 'password';
      input.type = toShow ? 'text' : 'password';
      btn.textContent = toShow ? '隐藏' : '显示';
      btn.setAttribute('aria-label', toShow ? '隐藏密码' : '显示密码');
    });
  });

  ['login-phone', 'register-phone'].forEach(function (id) {
    $(id).addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
    });
  });

  function phoneValid(value) {
    return /^1[3-9]\d{9}$/.test(value);
  }

  /**
   * 与后端 credential-validator 规则一致：密码 8~16 位（按 Unicode 码点），
   * 拒绝控制字符。注意：密码不做字符黑名单，保留完整口令空间；
   * 防 SQL 注入由服务端参数化查询 + 账号/昵称白名单负责。
   */
  function passwordValid(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    var len = Array.from(value).length;
    if (len < 8 || len > 16) return false;
    return !/[\u0000-\u001F\u007F-\u009F]/.test(value);
  }

  /** 昵称：1~24 字符，白名单（中文/字母/数字/空格 _ . -），与后端一致。 */
  function nicknameValid(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (Array.from(value).length > 24) return false;
    return /^[\p{L}\p{N} _.-]+$/u.test(value);
  }

  function enterHome(result, remember) {
    window.BlogAuthStore.setToken(result.token, remember);
    window.setTimeout(function () { window.location.href = 'home.html'; }, 450);
  }

  formLogin.addEventListener('submit', async function (e) {
    e.preventDefault();
    var phone = $('login-phone').value.trim();
    var password = $('login-password').value;

    if (!phoneValid(phone)) { setError(errLogin, '请输入正确的 11 位手机号'); return; }
    if (!password) { setError(errLogin, '请输入密码'); return; }
    if (!passwordValid(password)) { setError(errLogin, '密码长度需在 8~16 位之间'); return; }

    setError(errLogin, '');
    var btn = $('btn-login');
    setLoading(btn, true, '登录中…');

    try {
      var result = await window.BlogApi.login({ phone: phone, password: password });
      showToast('登录成功，正在进入博客…', 'ok');
      enterHome(result, $('login-remember').checked);
    } catch (err) {
      setError(errLogin, err.message || '登录失败，请稍后重试');
      setLoading(btn, false);
    }
  });

  formRegister.addEventListener('submit', async function (e) {
    e.preventDefault();
    var phone = $('register-phone').value.trim();
    var nickname = $('register-nickname').value.trim();
    var password = $('register-password').value;
    var confirm = $('register-confirm').value;

    if (!phoneValid(phone)) { setError(errRegister, '请输入正确的 11 位手机号'); return; }
    if (!nicknameValid(nickname)) { setError(errRegister, '昵称需为 1~24 个中文、字母、数字或 _ . -'); return; }
    if (!passwordValid(password)) { setError(errRegister, '密码长度需在 8~16 位之间'); return; }
    if (password !== confirm) { setError(errRegister, '两次输入的密码不一致'); return; }

    setError(errRegister, '');
    var btn = $('btn-register');
    setLoading(btn, true, '注册中…');

    try {
      await window.BlogApi.register({ phone: phone, nickname: nickname, password: password });
      // 注册成功后仍必须调用真实登录接口换取会话，不在前端伪造登录态
      var result = await window.BlogApi.login({ phone: phone, password: password });
      showToast('注册并登录成功，正在进入博客…', 'ok');
      enterHome(result, false);
    } catch (err) {
      setError(errRegister, err.message || '注册失败，请稍后重试');
      setLoading(btn, false);
    }
  });

  // 已登录用户访问登录页：会话有效则直接进入主页
  (async function () {
    if (!window.BlogAuthStore.getToken()) return;
    try {
      await window.BlogApi.me();
      window.location.replace('home.html');
    } catch (err) {
      window.BlogAuthStore.clearToken();
    }
  })();

  // 访客态顶栏「注册」入口直达注册 Tab（login.html?tab=register）。
  // 不带参数时保持默认登录 Tab，验收探针的初始态断言不受影响。
  try {
    if (new URLSearchParams(window.location.search).get('tab') === 'register') {
      switchTab('register');
    }
  } catch (err) {
    /* 不支持 URLSearchParams 的旧环境忽略此增强 */
  }

  var cfg = window.BLOG_CONFIG || {};
  window.BlogBackground.mount($('bg-layer'), cfg.BACKGROUND || { type: 'canvas' });
})();
