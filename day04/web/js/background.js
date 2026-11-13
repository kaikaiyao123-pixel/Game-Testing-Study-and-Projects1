'use strict';

/**
 * 动态背景引擎。
 *
 * 'video'      官方 1920x1080 MP4 动态壁纸，仅循环播放指定片段
 *              （当前默认 3s~6s，见 config.js 的 video.clipStart / clipEnd）；
 *              底层保留静态封面作首帧 / 解码失败兜底，并叠加透明 Canvas 光效。
 * 'wallpaper'  静态封面铺底 + 透明 Canvas 动态光效叠加
 * 'canvas'     程序化粒子 + 光斑动画（零资源依赖）
 * 'slideshow'  多图轮播渐变
 * 'image'/'gif'  本地图片，资源缺失时自动回退到 canvas，不白屏
 *
 * 所有素材均本地化在 web/assets/ 下，页面无外部资源依赖。
 */
(function () {
  function builtinSlides() {
    var palettes = [
      ['#fdeee9', '#f6c6b2', '#ee9a86', '#c0455e'],
      ['#fff4e6', '#ffd8a8', '#f6a96b', '#e4736a'],
      ['#f7eef7', '#e2c6dd', '#c39ab7', '#8b5c86'],
      ['#fdf0f2', '#f6c4cf', '#e28ea4', '#a3354f'],
    ];
    return palettes.map(function (p) {
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">' +
        '<defs>' +
        '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="' + p[0] + '"/>' +
        '<stop offset="0.55" stop-color="' + p[1] + '"/>' +
        '<stop offset="1" stop-color="' + p[2] + '"/>' +
        '</linearGradient>' +
        '<radialGradient id="r" cx="0.78" cy="0.22" r="0.65">' +
        '<stop offset="0" stop-color="' + p[3] + '" stop-opacity="0.42"/>' +
        '<stop offset="1" stop-color="' + p[3] + '" stop-opacity="0"/>' +
        '</radialGradient>' +
        '</defs>' +
        '<rect width="1600" height="900" fill="url(#g)"/>' +
        '<rect width="1600" height="900" fill="url(#r)"/>' +
        '</svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  var COOL_BLOBS = [
    { x: 0.18, y: 0.22, r: 0.55, rgb: '238,122,106', alpha: 0.30, sp: 0.28, ph: 0.4 },
    { x: 0.82, y: 0.18, r: 0.50, rgb: '246,169,107', alpha: 0.26, sp: 0.22, ph: 2.1 },
    { x: 0.72, y: 0.82, r: 0.58, rgb: '214,126,168', alpha: 0.24, sp: 0.19, ph: 4.0 },
    { x: 0.22, y: 0.86, r: 0.48, rgb: '139,92,134', alpha: 0.16, sp: 0.25, ph: 5.6 },
  ];

  var WARM_BLOBS = [
    { x: 0.20, y: 0.26, r: 0.52, rgb: '255,196,142', alpha: 0.20, sp: 0.26, ph: 0.4 },
    { x: 0.80, y: 0.20, r: 0.46, rgb: '255,142,126', alpha: 0.16, sp: 0.21, ph: 2.1 },
    { x: 0.72, y: 0.80, r: 0.54, rgb: '255,222,180', alpha: 0.16, sp: 0.18, ph: 4.0 },
    { x: 0.24, y: 0.84, r: 0.46, rgb: '214,126,168', alpha: 0.12, sp: 0.24, ph: 5.6 },
  ];

  /**
   * @param {object} opts
   *   transparent  为 true 时不绘制底色，仅绘制暖色光斑与光点（用于叠加在壁纸上）
   *   glow         光斑/光点强度系数，0~1，仅透明模式有意义
   *   dotCount     漂浮光点数量
   */
  function mountCanvas(layer, opts) {
    opts = opts || {};
    var transparent = !!opts.transparent;
    var glow = Number(opts.glow);
    if (!isFinite(glow) || glow <= 0) glow = 1;
    var blobs = transparent ? WARM_BLOBS : COOL_BLOBS;

    var canvas = document.createElement('canvas');
    canvas.className = transparent ? 'bg-canvas is-overlay' : 'bg-canvas';
    layer.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    if (!ctx) {
      return function () {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      };
    }

    var reduce =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var dotCount = Number(opts.dotCount) || 46;
    var dots = [];
    for (var i = 0; i < dotCount; i += 1) {
      dots.push({
        x: Math.random(),
        y: Math.random(),
        r: 1 + Math.random() * 2.3,
        sp: 0.006 + Math.random() * 0.014,
        ph: Math.random() * 6.28,
        a: 0.08 + Math.random() * 0.14,
      });
    }

    var w = 1;
    var h = 1;
    var dpr = 1;
    var raf = 0;
    var visible = !document.hidden;
    var disposed = false;

    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (!transparent) {
        ctx.fillStyle = '#f7eee9';
        ctx.fillRect(0, 0, w, h);
      }

      var t = now / 1000;
      blobs.forEach(function (b) {
        var cx = w * (b.x + 0.10 * Math.sin(t * b.sp + b.ph));
        var cy = h * (b.y + 0.10 * Math.cos(t * b.sp * 0.8 + b.ph));
        var radius = Math.max(w, h) * b.r;
        var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, 'rgba(' + b.rgb + ',' + (b.alpha * glow) + ')');
        gradient.addColorStop(1, 'rgba(' + b.rgb + ',0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      dots.forEach(function (d) {
        var x = ((d.x + t * d.sp * 0.15) % 1) * w;
        var y = (d.y + 0.02 * Math.sin(t * d.sp * 8 + d.ph)) * h;
        ctx.fillStyle = transparent
          ? 'rgba(255,238,214,' + (d.a * glow * 0.9) + ')'
          : 'rgba(192,69,94,' + (d.a * 0.8) + ')';
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI * 2);
        ctx.fill();
      });

      if (!reduce && visible && !disposed) raf = window.requestAnimationFrame(draw);
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(layer.clientWidth, 1);
      h = Math.max(layer.clientHeight, 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';

      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      if (reduce || !visible) draw(window.performance.now());
      else raf = window.requestAnimationFrame(draw);
    }

    function onVisibility() {
      visible = !document.hidden;
      if (visible && !reduce && !disposed) {
        if (raf) window.cancelAnimationFrame(raf);
        raf = window.requestAnimationFrame(draw);
      } else if (!visible && raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    resize();

    return function () {
      disposed = true;
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }

  /** 壁纸铺底 + 透明动态光效层；壁纸缺失时回退到不透明 Canvas 背景。 */
  function mountWallpaper(layer, cfg) {
    cfg = cfg || {};
    var img = document.createElement('img');
    img.className = 'bg-media bg-wallpaper';
    img.alt = '';

    var failed = false;
    var disposeFallback = null;

    function onFail() {
      if (failed) return;
      failed = true;
      if (img.parentNode) img.parentNode.removeChild(img);
      disposeFallback = mountCanvas(layer, { dotCount: 46 });
      console.warn('[background] 未找到壁纸 ' + img.src + '，已回退到 Canvas 动态背景。');
    }

    img.addEventListener('error', onFail);
    img.src = cfg.src || 'assets/wallpaper.jpg';
    layer.appendChild(img);

    var glow = cfg.glow;
    if (glow === undefined || glow === null) glow = 0.34;
    var disposeOverlay = mountCanvas(layer, {
      transparent: true,
      dotCount: Number(cfg.dots) || 22,
      glow: Number(glow) || 0.34,
    });

    return function () {
      disposeOverlay();
      if (disposeFallback) disposeFallback();
      if (img.parentNode) img.parentNode.removeChild(img);
    };
  }

  function mountSlideshow(layer, opts) {
    var images = opts.images && opts.images.length ? opts.images : builtinSlides();
    var fadeMs = Number(opts.fadeMs) || 1200;
    var slides = images.map(function (src) {
      var el = document.createElement('div');
      el.className = 'bg-slide';
      el.style.backgroundImage = 'url("' + src + '")';
      el.style.transitionDuration = fadeMs + 'ms';
      layer.appendChild(el);
      return el;
    });

    var index = 0;
    function activate() {
      slides.forEach(function (el, i) {
        if (i === index) el.classList.add('is-active');
        else el.classList.remove('is-active');
      });
      index = (index + 1) % slides.length;
    }
    activate();
    var timer = window.setInterval(activate, Number(opts.intervalMs) || 6000);

    return function () {
      window.clearInterval(timer);
      slides.forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    };
  }

  function withFallback(layer, opts, create) {
    var disposeChild = null;
    var element = null;
    var failed = false;

    function onFail() {
      if (failed) return; // error 事件可能触发多次，只允许回退一次
      failed = true;
      if (element && element.parentNode) element.parentNode.removeChild(element);
      element = null;
      disposeChild = mountCanvas(layer, opts.canvas || {});
    }

    element = create(onFail);
    if (element) layer.appendChild(element);

    return function () {
      if (disposeChild) disposeChild();
      if (element && element.parentNode) element.parentNode.removeChild(element);
    };
  }

  function mountImage(layer, cfg, opts) {
    return withFallback(layer, opts, function (onFail) {
      var img = document.createElement('img');
      img.className = 'bg-media';
      img.alt = '';
      img.addEventListener('error', function () {
        console.warn(
          '[background] 未找到背景资源 ' + img.src + '，已回退到 Canvas 动态背景。' +
          '把 GIF / JPG 放到 web/assets/ 下即可生效。'
        );
        onFail();
      });
      img.src = cfg.src || 'assets/wallpaper.jpg';
      return img;
    });
  }

  /**
   * 真·动态壁纸：官方 MP4 片段循环播放。
   *
   * 层级自下而上：静态封面（首帧 / 兜底）→ video → 透明 Canvas 光效 → bg-veil。
   * 视频解码失败或 autoplay 被拒时保留封面与光效，降级为静态壁纸，不白屏。
   * 封面同样带 .bg-wallpaper，保证渲染探针与 UI 探针的既有断言继续成立。
   *
   * 播放区间：原生 loop 只能循环整段，无法表达「只播 3s~6s」。
   * 配置 video.clipStart / clipEnd 时关闭原生 loop，改为手动区间循环：
   *   - loadedmetadata：定位到 clipStart，并把 clipEnd 收敛到实际时长内
   *   - timeupdate：越过 clipEnd 或跌出 clipStart 时回跳到 clipStart
   *   - ended：后台标签页节流漏掉 timeupdate 时兜底回跳并续播
   * 区间值写入 video.dataset，供 ui-probe.js 做程序化验收。
   * 未配置区间时保持原有「整段循环」（loop=true），向后兼容。
   */
  function mountVideo(layer, cfg, opts) {
    cfg = cfg || {};
    opts = opts || {};
    var vOpts = opts.video || {};
    var wallSrc =
      (opts.wallpaper && opts.wallpaper.src) || cfg.poster || 'assets/wallpaper.jpg';

    var reduce =
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 解析片段区间；无效配置退化为「整段循环」，保持向后兼容
    var clipStart = Number(vOpts.clipStart);
    var clipEnd = Number(vOpts.clipEnd);
    var hasClip =
      vOpts.clipStart !== undefined && vOpts.clipEnd !== undefined &&
      isFinite(clipStart) && isFinite(clipEnd) &&
      clipStart >= 0 && clipEnd > clipStart;
    if (!hasClip) { clipStart = 0; clipEnd = Infinity; }

    // 1) 底层封面：视频加载期间的 poster 兜底，也是解码失败时的最终画面
    var img = document.createElement('img');
    img.className = 'bg-media bg-wallpaper is-underlay';
    img.alt = '';
    img.src = wallSrc;
    layer.appendChild(img);

    // 2) 视频层：静音 + 内联；有片段区间时关闭原生 loop，改由 timeupdate 手动循环
    var video = document.createElement('video');
    video.className = 'bg-media bg-video';
    video.muted = true;
    video.loop = !hasClip;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.preload = 'auto';
    video.autoplay = !reduce;
    if (cfg.poster) video.poster = cfg.poster;
    if (hasClip) {
      video.dataset.clipStart = String(clipStart);
      video.dataset.clipEnd = String(clipEnd);
    }

    var failed = false;
    function onFail() {
      if (failed) return; // error 可能多次触发，只降级一次
      failed = true;
      if (video.parentNode) video.parentNode.removeChild(video);
      console.warn('[background] 动态壁纸视频不可用，已降级为静态壁纸 + 动态光效。');
    }

    function seekTo(t) {
      if (video.readyState < 1) return; // metadata 未就绪时不可 seek
      try { video.currentTime = t; } catch (e) { /* seeking 中赋值被拒，忽略 */ }
    }

    function onLoadedMetadata() {
      if (!hasClip || failed) return;
      // 素材比配置区间短时，把终点收敛到实际时长，避免 seek 到不可达位置
      if (isFinite(video.duration) && video.duration > 0 && clipEnd > video.duration) {
        clipEnd = video.duration;
        video.dataset.clipEnd = String(clipEnd);
      }
      seekTo(clipStart);
    }

    // 片段只有 3 秒，回跳处容易看出硬切。回跳瞬间做一次 320ms 的
    // 亮度/透明度柔化（CSS 类），把跳帧掩进一次呼吸里。
    function softenLoop() {
      if (reduce || failed) return;
      // 先移除并强制重排，否则连续回跳时同名动画不会重播
      video.classList.remove('is-loop-soften');
      void video.offsetWidth;
      video.classList.add('is-loop-soften');
    }

    function onTimeUpdate() {
      if (!hasClip || failed) return;
      var t = video.currentTime;
      // timeupdate 约每 250ms 触发一次，越界即回跳到片段起点
      if (t >= clipEnd || t < clipStart - 0.3) {
        seekTo(clipStart);
        softenLoop();
      }
    }

    function onEnded() {
      // 后台标签页节流可能跳过 timeupdate 直接播到结尾，此处兜底续播片段
      if (!hasClip || failed) return;
      seekTo(clipStart);
      if (!reduce) {
        var p = video.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    }

    video.addEventListener('error', onFail);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    video.src = cfg.src || 'assets/wallpaper-preview.mp4';
    layer.appendChild(video);

    if (!reduce) {
      var play = video.play();
      if (play && typeof play.catch === 'function') {
        play.catch(function () {
          // autoplay 被策略拒绝时保留 poster 画面，不强制移除视频层
          console.warn('[background] 视频自动播放被浏览器阻止，保留封面画面。');
        });
      }
    }

    // 3) 透明 Canvas 光效：保持 .bg-canvas 契约，与静态壁纸模式视觉一致
    var glow = vOpts.glow;
    if (glow === undefined || glow === null) glow = 0.30;
    var disposeOverlay = mountCanvas(layer, {
      transparent: true,
      dotCount: Number(vOpts.dots) || 22,
      glow: Number(glow) || 0.30,
    });

    return function () {
      disposeOverlay();
      video.removeEventListener('error', onFail);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      try { video.pause(); } catch (e) { /* ignore */ }
      if (video.parentNode) video.parentNode.removeChild(video);
      if (img.parentNode) img.parentNode.removeChild(img);
    };
  }

  function mount(layer, config) {
    if (!layer) return function () {};
    var cfg = config || { type: 'wallpaper' };
    var dispose = function () {};

    try {
      if (cfg.type === 'wallpaper') {
        dispose = mountWallpaper(layer, cfg.wallpaper || {});
      } else if (cfg.type === 'slideshow') {
        dispose = mountSlideshow(layer, cfg.slideshow || {});
      } else if (cfg.type === 'image' || cfg.type === 'gif') {
        dispose = mountImage(layer, cfg.media || {}, cfg);
      } else if (cfg.type === 'video') {
        dispose = mountVideo(layer, cfg.media || {}, cfg);
      } else {
        dispose = mountCanvas(layer, cfg.canvas || {});
      }
    } catch (err) {
      console.warn('[background] 挂载失败，回退到 Canvas:', err);
      dispose = mountCanvas(layer, cfg.canvas || {});
    }

    var veil = document.createElement('div');
    veil.className = 'bg-veil';
    layer.appendChild(veil);

    return function () {
      dispose();
      if (veil.parentNode) veil.parentNode.removeChild(veil);
    };
  }

  window.BlogBackground = { mount: mount, builtinSlides: builtinSlides };
})();
