'use strict';

/** HTTP 通用工具：JSON 响应、请求体解析、CORS、Bearer 令牌提取。 */

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function applyCors(req, res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

function sendText(res, status, text) {
  const data = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];

    const fail = (err) => {
      if (settled) return;
      settled = true;
      req.resume(); // 继续排空请求体，避免连接挂死
      reject(err);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(httpError(413, '请求体过大'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, '请求体不是合法 JSON'));
      }
    });

    req.on('error', (err) => fail(err));
    req.on('aborted', () => fail(httpError(400, '请求被中断')));
  });
}

function getBearer(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const matched = /^Bearer\s+(.+)$/i.exec(String(header));
  return matched ? matched[1].trim() : null;
}

module.exports = {
  httpError,
  applyCors,
  sendJson,
  sendText,
  readJson,
  getBearer,
};
