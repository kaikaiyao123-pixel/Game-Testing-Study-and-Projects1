'use strict';

/**
 * 路由守卫（方案 §5 决策 2：拆分为匿名可读 / 登录态增强两种模式）。
 *
 *   optionalLogin() —— 公开读页面（主页 / 列表 / 详情 / 时间线 / 分享页 / 页面壳）。
 *                      有令牌则向 /api/me 校验并注入用户；无令牌、令牌失效、会话过期
 *                      或服务端不可达，一律按访客态返回，绝不跳转登录页。
 *   requireLogin()  —— 写操作 / 编辑器 / 发布页 / 设置页（P2 起使用）。
 *                      保持原有「无有效会话即重定向登录页」行为，本阶段不启用。
 *
 * 两者都会移除 body.guard-pending，避免守卫完成前页面长时间不可见。
 * 公开页不再强制跳转，是「匿名读 / 登录写分离」（P9）的前端前提。
 */
(function () {
  function releasePending() {
    document.body.classList.remove('guard-pending');
  }

  function guest(reason) {
    return { guest: true, user: null, session: null, reason: reason || null };
  }

  function loggedIn(result) {
    var data = result || {};
    return {
      guest: false,
      user: data.user || null,
      session: data.session || null,
      raw: data,
    };
  }

  async function optionalLogin() {
    if (!window.BlogAuthStore.getToken()) {
      releasePending();
      return guest('no-token');
    }

    try {
      var result = await window.BlogApi.me();
      releasePending();
      return loggedIn(result);
    } catch (err) {
      // 令牌过期 / 已登出 / 网络异常：降级为访客，不阻断公开内容渲染。
      window.BlogAuthStore.clearToken();
      releasePending();
      return guest('invalid-token');
    }
  }

  async function requireLogin() {
    if (!window.BlogAuthStore.getToken()) {
      window.location.replace('login.html');
      return null;
    }

    try {
      var result = await window.BlogApi.me();
      releasePending();
      return loggedIn(result);
    } catch (err) {
      window.BlogAuthStore.clearToken();
      window.location.replace('login.html');
      return null;
    }
  }

  window.BlogGuard = {
    optionalLogin: optionalLogin,
    requireLogin: requireLogin,
  };
})();
