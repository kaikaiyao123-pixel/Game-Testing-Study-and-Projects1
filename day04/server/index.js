'use strict';

/**
 * 纯 API 层：只处理 /api/*，输出 JSON，不渲染任何 HTML。
 * 这也是前后端分离的边界：可独立监听另一个端口/域名，前端仅通过 fetch 访问。
 */
const config = require('./config');
const auth = require('./api/auth');
const {
  applyCors,
  sendJson,
  readJson,
  getBearer,
} = require('./lib/http-utils');

function createApiHandler() {
  return async function handleApi(req, res) {
    applyCors(req, res, config.CORS_ORIGIN);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }

    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      sendJson(res, 400, { ok: false, message: '非法请求路径' });
      return true;
    }

    if (!pathname.startsWith('/api/')) return false;

    const route = `${req.method} ${pathname}`;

    try {
      switch (route) {
        case 'GET /api/health': {
          sendJson(res, 200, {
            ok: true,
            service: 'blog-auth-mock-api',
            time: new Date().toISOString(),
            ...(await auth.stats()),
          });
          break;
        }

        case 'POST /api/register': {
          const body = await readJson(req, config.MAX_BODY_BYTES);
          const result = await auth.register(body);
          sendJson(res, 201, { ok: true, message: '注册成功', ...result });
          break;
        }

        case 'POST /api/login': {
          const body = await readJson(req, config.MAX_BODY_BYTES);
          const result = await auth.login(body, {
            userAgent: req.headers['user-agent'],
            ip: req.socket.remoteAddress,
          });
          sendJson(res, 200, { ok: true, message: '登录成功', ...result });
          break;
        }

        case 'GET /api/me': {
          const result = await auth.me(getBearer(req));
          sendJson(res, 200, { ok: true, ...result });
          break;
        }

        case 'POST /api/logout': {
          const result = await auth.logout(getBearer(req));
          sendJson(res, 200, { ok: true, message: '已退出登录', ...result });
          break;
        }

        default: {
          sendJson(res, 404, { ok: false, message: `接口不存在: ${route}` });
        }
      }
    } catch (err) {
      const status = Number(err.status) || 500;
      if (status >= 500) console.error('[api] 未处理异常:', err);
      sendJson(res, status, {
        ok: false,
        message: status >= 500 ? '服务端内部错误' : err.message,
      });
    }

    return true;
  };
}

module.exports = { createApiHandler };
