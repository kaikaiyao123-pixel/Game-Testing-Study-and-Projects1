'use strict';

/**
 * 前端配置（唯一需要改动的配置入口）。
 *
 * API_BASE：前后端同端口开发时留空即可；若前端独立部署到别的域名/端口，
 *          改成后端地址，例如 'http://127.0.0.1:3000'（后端已开启 CORS）。
 *
 * BACKGROUND.type 支持 6 种背景：
 *   'video'      官方 1920x1080 MP4 动态壁纸，只循环播放指定片段
 *                （当前默认 3s ~ 6s，见 video.clipStart / clipEnd；壁纸本身在动）
 *   'wallpaper'  静态封面铺底 + Canvas 动态光效叠加
 *   'canvas'     程序化粒子 + 光斑动画（零资源依赖）
 *   'slideshow'  多图轮播渐变（不配置 images 时使用内置渐变 SVG 图）
 *   'image'      静态图片（把文件放到 web/assets/ 下）
 *   'gif'        动态 GIF 图片（同上，直接把 media.src 指向 .gif）
 * image / gif 资源不存在时自动回退到 canvas；video 资源不可用时降级为
 * 静态封面 + 动态光效，均不会白屏。
 *
 * 素材均来自用户指定的壁纸详情页，已本地化到 web/assets/，页面可离线打开。
 */
window.BLOG_CONFIG = {
  // 决策 8：站点显示名统一为「炫与梓」，作为前端本地常量。
  // 运行时可由服务端 GET /api/site/config 覆盖（见 js/site.js 的 applyBrand）。
  // selfcheck.js 会对所有页面的品牌串做一致性断言，避免多处硬编码漂移。
  SITE_NAME: '炫与梓',

  // 阶段二：真实后端 Spring Boot（本机 8081 / 容器化时同样是 8081）。
  // 若改回阶段一的 Node Mock 服务，改成 '' 并运行 node server/app.js。
  API_BASE: 'http://127.0.0.1:8081',

  BACKGROUND: {
    // 当前默认：官方动态壁纸视频（10 秒 / 30fps / 300 帧 / 1920x1080），
    // 但只循环播放第 3 秒到第 6 秒这一段（见下方 clipStart / clipEnd）。
    // 想切回「静态封面 + 光效」：把 type 改成 'wallpaper' 即可。
    type: 'video',

    // 真·动态壁纸：叠加光效参数 + 播放区间
    video: {
      glow: 0.30, // 叠加光斑强度（0~1，越低越克制）
      dots: 22,   // 漂浮光点数量

      // 只播放 [clipStart, clipEnd) 这一段并循环，单位：秒。
      // 原生 loop 只能循环整段，故由 background.js 用 timeupdate 手动回跳实现。
      // 想恢复整段循环：把这两项删掉，或设为 clipStart:0 / clipEnd:10。
      clipStart: 3,
      clipEnd: 6,
    },

    // 壁纸封面：视频 poster、首帧兜底，以及 wallpaper 模式共用
    wallpaper: {
      src: 'assets/wallpaper.jpg', // 官方封面 1280x720
      glow: 0.34,
      dots: 22,
    },

    canvas: {
      dotCount: 46,
    },

    slideshow: {
      images: null,
      intervalMs: 6000,
      fadeMs: 1200,
    },

    // video / image / gif 共用的媒体源
    media: {
      src: 'assets/wallpaper-preview.mp4', // 官方动态壁纸预览
      poster: 'assets/wallpaper.jpg',
    },
  },
};
