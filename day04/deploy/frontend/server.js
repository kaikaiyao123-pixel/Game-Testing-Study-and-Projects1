'use strict';

/**
 * 生产前端入口：静态资源 + /api 反向代理，对外只暴露一个端口。
 *
 * 设计要点：
 *  1. 静态部分复用仓库既有 server/static.js，不改一行业务代码；
 *  2. /api/** 转发到 BACKEND_ORIGIN，浏览器全程同源，因此不需要 CORS，
 *     也不需要把后端公网域名注入前端（规避 selfcheck 的零外链断言）；
 *  3. 后端不可达时返回 JSON（前端 api.js 会 response.json()，不能返回纯文本）。
 */
const http = require('node:http');
const path = require('node:path');

const ROOT = process.cwd();
const { createStaticHandler } = require(path.join(ROOT, 'server', 'static.js'));
const { sendJson } = require(path.join(ROOT, 'server', 'lib', 'http-utils.js'));

// 不读取平台自动注入的 PORT：Zeabur / Compose 都按 ports 声明把流量转到容器 3000，
// 用固定端口可避免「平台 PORT 与声明端口不一致」这类隐性错配。
const PORT = Number(process.env.BLOG_FRONTEND_PORT || 3000);
const HOST = process.env.BLOG_HOST || '0.0.0.0';
const BACKEND = new URL(process.env.BACKEND_ORIGIN || 'http://backend:8081');
const BACKEND_PORT = Number(BACKEND.port || (BACKEND.protocol === 'https:' ? 443 : 80));
const handleStatic = createStaticHandler();

function proxy(req, res) {
  const upstream = http.request(
    {
      protocol: BACKEND.protocol,
      hostname: BACKEND.hostname,
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: Object.assign({}, req.headers, { host: BACKEND.host }),
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    console.error('[proxy] 后端不可达:', err.message);
    if (!res.headersSent) {
      sendJson(res, 502, { ok: false, message: '后端服务暂不可用，请稍后重试' });
    } else {
      res.end();
    }
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    proxy(req, res);
    return;
  }
  Promise.resolve()
    .then(() => handleStatic(req, res))
    .catch((err) => {
      console.error('[frontend] 未处理异常:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, message: '静态服务内部错误' });
      } else {
        res.end();
      }
    });
});

server.on('error', (err) => {
  console.error('[启动失败]', err);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[frontend] ${HOST}:${PORT} 静态资源 + /api -> ${BACKEND.origin}`);
  console.log('[frontend] 登录页 /login.html · 健康检查 /api/health');
});

module.exports = { server };
