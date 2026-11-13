'use strict';

/**
 * 首页首屏诗句：逐字浮现。
 *
 * 文案唯一数据源是 .poem-line 的 data-text；逐字用 createElement + textContent
 * 生成，绝不拼接 innerHTML（项目硬约束：用户文本一律 textContent）。
 * 动画由 CSS animation-delay 驱动，一次性建立 DOM，不启动逐字定时器。
 * prefers-reduced-motion 下直接全显、不显示光标。
 * 仅首页引入，其它页面不加载。
 */
(function () {
  var STEP_S = 0.16;   // 每个字的间隔（秒）
  var FADE_S = 0.62;   // 单字淡入时长，需与 CSS .poem-char 保持一致
  var LOOP = false;    // 默认只播一轮；改为 true 可循环（停留 9 秒后重播）
  var HOLD_MS = 9000;

  var root = document.getElementById('home-poem');
  if (!root) return;

  var lines = [].slice.call(root.querySelectorAll('.poem-line'));
  if (!lines.length) return;

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function build() {
    var all = [];
    lines.forEach(function (line) {
      line.textContent = '';
      var text = line.getAttribute('data-text') || '';
      Array.from(text).forEach(function (ch) {
        var span = document.createElement('span');
        span.className = 'poem-char';
        span.textContent = ch;
        span.setAttribute('aria-hidden', 'true');
        if (!reduce) {
          span.style.animationDelay = (all.length * STEP_S).toFixed(2) + 's';
        }
        line.appendChild(span);
        all.push(span);
      });
    });

    var caret = document.createElement('span');
    caret.className = 'poem-caret';
    caret.setAttribute('aria-hidden', 'true');
    lines[lines.length - 1].appendChild(caret);
    return { chars: all, caret: caret };
  }

  function play() {
    var built = build();
    if (reduce) {
      root.classList.add('is-static');
      return;
    }
    var totalMs = built.chars.length * STEP_S * 1000 + FADE_S * 1000;
    window.setTimeout(function () {
      built.caret.classList.add('is-on');
    }, totalMs);

    if (LOOP) window.setTimeout(play, totalMs + HOLD_MS);
  }

  play();
})();
