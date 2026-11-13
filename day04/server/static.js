'use strict';

/**
 * 静态前端托管层：只负责把 web/ 目录的文件原样送出。
 * 不含任何业务逻辑，可与 API 层拆到不同进程 / 域名部署。
 * 已做目录穿越防护，避免 data/ 下的用户数据被当作静态文件读取。
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const config = require('./config');
const { sendText } = require('./lib/http-utils');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function createStaticHandler() {
  return async function handleStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, '仅支持 GET / HEAD');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      sendText(res, 400, '非法路径');
      return;
    }

    if (pathname === '/' || pathname === '') pathname = '/login.html';

    const target = path.resolve(config.WEB_DIR, `.${pathname}`);
    const relative = path.relative(config.WEB_DIR, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      sendText(res, 403, '禁止访问该路径');
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(target);
    } catch {
      sendText(res, 404, `页面不存在: ${pathname}`);
      return;
    }
    if (!stat.isFile()) {
      sendText(res, 404, `页面不存在: ${pathname}`);
      return;
    }

    const ext = path.extname(target).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };

    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  };
}

module.exports = { createStaticHandler };
