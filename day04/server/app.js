'use strict';

/**
 * 开发态单端口入口：把「API 层」与「静态前端层」组合进同一个 HTTP 进程。
 * 两层代码本身互不依赖，生产可拆成两个服务分别部署（见 README）。
 * 启动：node server/app.js
 */
const http = require('node:http');
const config = require('./config');
const { createApiHandler } = require('./index');
const { createStaticHandler } = require('./static');
const { sendJson } = require('./lib/http-utils');

const handleApi = createApiHandler();
const handleStatic = createStaticHandler();

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => handleApi(req, res))
    .then((handled) => {
      if (handled === false) return handleStatic(req, res);
      return undefined;
    })
    .catch((err) => {
      console.error('[server] 未处理异常:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, message: '服务端内部错误' });
      } else {
        res.end();
      }
    });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[启动失败] 端口 ${config.PORT} 已被占用。可设置环境变量 BLOG_PORT 更换端口后重试。`
    );
  } else {
    console.error('[启动失败]', err);
  }
  process.exitCode = 1;
});

server.listen(config.PORT, config.HOST, () => {
  // BLOG_PORT=0 时由系统分配端口，日志应显示实际端口
  const actualPort = server.address().port;
  const base = `http://${config.HOST}:${actualPort}`;
  console.log('');
  console.log('  个人博客 · 登录鉴权服务已启动');
  console.log('  ---------------------------------------------');
  console.log(`  登录页    ${base}/login.html`);
  console.log(`  登录后主页 ${base}/home.html`);
  console.log(`  健康检查  ${base}/api/health`);
  console.log(`  数据目录  ${config.DATA_DIR}`);
  console.log('  ---------------------------------------------');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});

module.exports = { server };
