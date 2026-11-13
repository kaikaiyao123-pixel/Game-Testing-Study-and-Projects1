'use strict';

/**
 * 纯静态前端服务（阶段二）。
 * 只托管 web/ 目录，不再提供任何 /api 接口 —— API 全部由 Spring Boot 承担，
 * 前端通过 web/js/config.js 的 API_BASE 跨域访问，这才是真正的前后端分离。
 *
 * 启动：node server/frontend.js   （默认 http://127.0.0.1:3000/login.html）
 */
const http = require('node:http');
const config = require('./config');
const { createStaticHandler } = require('./static');
const { sendJson } = require('./lib/http-utils');

const PORT = Number(process.env.BLOG_FRONTEND_PORT || 3000);
const handleStatic = createStaticHandler();

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => handleStatic(req, res))
    .catch((err) => {
      console.error('[frontend] 未处理异常:', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, message: '静态服务内部错误' });
      else res.end();
    });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[启动失败] 端口 ${PORT} 已被占用，可设置 BLOG_FRONTEND_PORT 更换端口。`);
  } else {
    console.error('[启动失败]', err);
  }
  process.exitCode = 1;
});

server.listen(PORT, config.HOST, () => {
  const base = `http://${config.HOST}:${PORT}`;
  console.log('');
  console.log('  个人博客 · 静态前端已启动');
  console.log('  ---------------------------------------------');
  console.log(`  登录页    ${base}/login.html`);
  console.log(`  后端 API  http://127.0.0.1:8081/api/health`);
  console.log('  ---------------------------------------------');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});

module.exports = { server };
