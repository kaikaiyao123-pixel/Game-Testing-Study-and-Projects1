'use strict';

/**
 * 全站顶栏共享层（P1）。
 *
 * 所有非登录页使用同一套 topbar DOM 骨架（相同 id 集合），因此本文件可安全复用：
 *   - 访客态 / 登录态双渲染（决策 2）
 *   - 头像下拉的真实点击交互、点击外部 / Esc 收起、aria-expanded 同步
 *   - 移动端 #nav-toggle 折叠
 *   - 当前页导航高亮（data-page ↔ data-nav）
 *   - 站点品牌应用（config.js 常量 + 可选服务端 /api/site/config 覆盖）
 *   - 真实登出（调用 /api/logout，无论成败都清本地凭证）
 *   - 动态壁纸背景层挂载
 *
 * 说明：下拉交互与登出逻辑原本在 home.js 内，P1 抽出到此处供 7 个页面壳共用；
 * home.js 现在只负责主页 Hero 的会话元信息渲染。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var menuBtn = $('user-menu-btn');
  var dropdown = $('user-dropdown');
  var sessionBox = $('user-session');
  var guestBox = $('user-guest');
  var navToggle = $('nav-toggle');
  var mainNav = $('main-nav');

  /* ---------- 品牌（决策 8） ---------- */
  function applyBrand(name) {
    if (!name) return;
    var labels = document.querySelectorAll('.brand-name');
    Array.prototype.forEach.call(labels, function (el) {
      el.textContent = name;
    });
    var title = document.title;
    var sep = title.indexOf(' · ');
    if (sep >= 0) document.title = title.slice(0, sep) + ' · ' + name;
  }

  /* ---------- 导航高亮 ---------- */
  function markActiveNav() {
    var page = document.body.getAttribute('data-page');
    var links = document.querySelectorAll('.nav-link[data-nav]');
    Array.prototype.forEach.call(links, function (link) {
      var active = link.getAttribute('data-nav') === page;
      if (active) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('is-active');
        link.removeAttribute('aria-current');
      }
    });
  }

  /* ---------- 头像下拉 ---------- */
  function setMenu(open) {
    if (!dropdown || !menuBtn) return;
    dropdown.hidden = !open;
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuBtn.classList.toggle('is-open', open);
  }

  /* ---------- 访客态 / 登录态双渲染 ---------- */
  function renderSession(state) {
    var isGuest = !state || state.guest !== false;
    if (sessionBox) sessionBox.hidden = isGuest;
    if (guestBox) guestBox.hidden = !isGuest;

    if (isGuest) {
      setMenu(false);
      return;
    }

    var user = state.user || {};
    var nickname = user.nickname || '博主';
    var nameEl = $('user-name');
    var avatarEl = $('user-avatar');
    var dropName = $('dropdown-name');
    if (nameEl) nameEl.textContent = nickname;
    // 头像是 <img>，只更新无障碍描述，不能用 textContent 覆盖
    if (avatarEl) avatarEl.alt = nickname + ' 的头像';
    if (dropName) dropName.textContent = nickname;
  }

  /* ---------- 交互绑定 ---------- */
  function initInteractions() {
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation(); // 避免立刻被 document 的「点击外部」逻辑收起
        setMenu(dropdown.hidden);
      });
    }

    document.addEventListener('click', function (e) {
      if (dropdown && !dropdown.hidden &&
          !dropdown.contains(e.target) &&
          !(menuBtn && menuBtn.contains(e.target))) {
        setMenu(false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dropdown && !dropdown.hidden) {
        setMenu(false);
        if (menuBtn) menuBtn.focus();
      }
    });

    if (navToggle && mainNav) {
      navToggle.addEventListener('click', function () {
        setMenu(false); // 移动导航与头像下拉不并存
        var opened = mainNav.classList.toggle('is-open');
        navToggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
      });
    }

    var logout = $('btn-logout');
    if (logout) {
      logout.addEventListener('click', async function () {
        logout.disabled = true;
        try {
          await window.BlogApi.logout();
        } catch (err) {
          /* 即使接口异常，本地凭证也必须清除 */
        }
        window.BlogAuthStore.clearToken();
        window.location.replace('login.html');
      });
    }
  }

  /* ---------- 初始化 ---------- */
  var cfg = window.BLOG_CONFIG || {};
  window.BlogBackground.mount($('bg-layer'), cfg.BACKGROUND || { type: 'wallpaper' });
  applyBrand(cfg.SITE_NAME || '炫与梓');
  markActiveNav();
  initInteractions();

  // 站点显示名可由服务端配置覆盖。公开读接口允许无令牌；失败时静默回退到本地常量。
  if (window.BlogApi && window.BlogApi.siteConfig) {
    window.BlogApi.siteConfig().then(function (res) {
      var data = res && res.data;
      if (data && typeof data.siteName === 'string' && data.siteName.trim()) {
        applyBrand(data.siteName.trim());
      }
    }).catch(function () {
      /* 保持 config.js 中的品牌常量，不影响页面渲染 */
    });
  }

  window.BlogSite = {
    renderSession: renderSession,
    applyBrand: applyBrand,
    markActiveNav: markActiveNav,
  };
})();
