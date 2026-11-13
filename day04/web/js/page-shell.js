'use strict';

/**
 * 7 个业务页 / 分享页共用的页面壳逻辑（P1，§7「同批交付」+ §8「三态齐备」）。
 *
 * 职责：
 *   - 调用 BlogGuard.optionalLogin()：公开页匿名可读，访客态不跳转（决策 2 / P9）
 *   - 按 body[data-page] 渲染模块标题、定位说明、空态引导
 *   - 管理加载态 / 空态 / 错误态三态（P8′ 硬要求）
 *   - 仅登录态显示「去创建」入口；访客态显示登录引导
 *
 * 本阶段只交付页面壳：所有模块统一收敛到「空态」，不伪造数据、不调用尚未
 * 实现的业务接口（避免导航指向 404 或白屏）。功能深度由 P2 / P3 分批填充。
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var PAGE_META = {
    articles: {
      kicker: 'F2 · 长内容',
      title: '文章',
      desc: '长文发布与阅读：分类、标签、Markdown 编辑与归档。',
      empty: '还没有发布过文章。第一篇可以写写这个站点是怎么搭起来的。',
      create: '写文章',
    },
    media: {
      kicker: 'F3 · 观影资料库',
      title: '影视资源',
      desc: '个人观影资料库与外链索引；本站不存储、不托管、不转存文件本体。',
      empty: '片单还是空的。可以先把最近想看的几部登记进来。',
      create: '添加条目',
    },
    vault: {
      kicker: 'F4 · 私人收藏夹',
      title: 'げん的宝库',
      desc: '链接 / 图片 / 书单 / 代码片段的两级收藏库（集合 + 条目）。',
      empty: '还没有收藏集合。新建一个集合，把散落各处的链接收进来。',
      create: '新建集合',
    },
    moments: {
      kicker: 'F5 · 轻动态',
      title: '碎碎念',
      desc: '无标题、无独立详情页的时间线，适合记录当下的短句。',
      empty: '还没有碎碎念。随手记一句，之后回看会很有意思。',
      create: '记一条',
    },
    profile: {
      kicker: 'F6 · 个人资料',
      title: '个人资料',
      desc: '头像、昵称、简介与公开内容概览；手机号仅脱敏展示。',
      empty: '资料编辑与公开主页将在后续阶段开放，当前为只读页面壳。',
      create: '编辑资料',
    },
    settings: {
      kicker: 'F7 · 账号设置',
      title: '账号设置',
      desc: '安全（改密 / 会话 / 登录记录）、偏好与危险操作三个分区。',
      empty: '账号设置项将在后续阶段开放，当前为只读页面壳。',
      create: '前往设置',
    },
    share: {
      kicker: 'F8 · 分享只读页',
      title: '分享内容',
      desc: '持有效分享链接即可只读查看，无需登录；页面不被搜索引擎索引。',
      empty: '此分享链接暂无可展示的内容，或链接已过期 / 已撤销。',
      create: '返回主页',
    },
  };

  var PANES = ['state-loading', 'state-empty', 'state-error'];

  function setState(name) {
    PANES.forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = id !== 'state-' + name;
    });
  }

  function renderMeta(meta, state) {
    var isGuest = !state || state.guest !== false;
    var setText = function (id, value) {
      var el = $(id);
      if (el) el.textContent = value;
    };

    setText('shell-kicker', meta.kicker);
    setText('shell-title', meta.title);
    setText('shell-desc', meta.desc);
    setText('shell-empty-hint', meta.empty);

    var create = $('shell-create');
    if (create) {
      create.textContent = meta.create;
      create.hidden = isGuest;
    }
    var guestHint = $('shell-guest-hint');
    if (guestHint) guestHint.hidden = !isGuest;
  }

  function initNotice() {
    var create = $('shell-create');
    var notice = $('shell-notice');
    if (!create || !notice) return;
    create.addEventListener('click', function () {
      // P2/P3 业务页已实现创建流程：空态里的「去创建」统一委派给 BlogPage.onCreate，
      // 与列表头的创建按钮走同一条路径，避免按钮只弹 P1 占位提示。
      if (window.BlogPage && typeof window.BlogPage.onCreate === 'function') {
        notice.hidden = true;
        try {
          window.BlogPage.onCreate();
          return;
        } catch (err) {
          // 钩子异常时继续回落，保证按钮始终有反馈
        }
      }
      notice.textContent = '当前页面暂未提供可用的创建入口，请稍后重试。';
      notice.hidden = false;
    });

    var retry = $('shell-retry');
    if (retry) {
      retry.addEventListener('click', function () {
        setState('loading');
        window.setTimeout(function () {
          var errText = $('shell-error-text');
          if (errText) errText.textContent = '内容加载失败，请稍后重试。';
          setState('empty');
        }, 320);
      });
    }
  }

  // 供 P2+ 各页面脚本复用：状态切换、元信息渲染、页面元配置。
  window.BlogShell = {
    setState: setState,
    renderMeta: renderMeta,
    PAGE_META: PAGE_META,
  };

  (async function () {
    var page = document.body.getAttribute('data-page') || 'articles';
    var meta = PAGE_META[page] || PAGE_META.articles;
    renderMeta(meta, null);
    initNotice();
    setState('loading');

    var state;
    try {
      state = await window.BlogGuard.optionalLogin();
      window.BlogSite.renderSession(state);
      renderMeta(meta, state);
    } catch (err) {
      window.BlogSite.renderSession({ guest: true });
      state = { guest: true };
    }

    if (window.BlogPage && typeof window.BlogPage.init === 'function') {
      // P2+：页面自行接管渲染（列表 / 详情 / 互动组件），需在本脚本之前引入页面脚本。
      try {
        window.BlogPage.init({ state: state, meta: meta, setState: setState, renderMeta: renderMeta });
      } catch (err) {
        var errText = $('shell-error-text');
        if (errText) errText.textContent = '页面加载失败，请稍后重试。';
        setState('error');
      }
      return;
    }

    // P1 向后兼容：未实现功能深度的页面壳统一展示空态。
    setState('empty');
  })();
})();
