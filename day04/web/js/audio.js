(function () {
  'use strict';
  var audio = document.getElementById('bg-audio');
  var btn = document.getElementById('audio-toggle');
  if (!audio || !btn) return;

  var KEY = 'blog:bgm';

  function reflect(on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-label', on ? '关闭背景音乐' : '开启背景音乐');
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  }

  function tryPlay() {
    var p = audio.play();
    if (p && p.catch) p.catch(function () { reflect(false); });
  }

  // 进入页面即尝试自动播放（满足「自动播放」诉求）。有声内容通常被浏览器拦截，
  // 被拦后保持关闭态，由用户点击开关开启（点击即满足手势要求）。
  var preferred = false;
  try { preferred = localStorage.getItem(KEY) === '1'; } catch (e) {}
  reflect(preferred);
  tryPlay();

  btn.addEventListener('click', function () {
    if (audio.paused) { reflect(true); tryPlay(); }
    else { audio.pause(); reflect(false); }
  });
})();
