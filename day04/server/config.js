'use strict';

/**
 * 全局配置。
 * 说明：当前阶段暂不引入 SpringBoot / MySQL / Redis，
 * 数据以 JSON 文件持久化（见 lib/store.js 的仓储抽象），
 * 后续替换为数据库时只需替换仓储实现，API 契约保持不变。
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.BLOG_DATA_DIR
  ? path.resolve(process.env.BLOG_DATA_DIR)
  : path.join(ROOT, 'data');

module.exports = {
  ROOT,
  WEB_DIR: path.join(ROOT, 'web'),
  DATA_DIR,
  USERS_FILE: path.join(DATA_DIR, 'users.json'),
  SESSIONS_FILE: path.join(DATA_DIR, 'sessions.json'),

  PORT: Number(process.env.BLOG_PORT || 3000),
  HOST: process.env.BLOG_HOST || '127.0.0.1',

  /** 会话有效期：7 天 */
  SESSION_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  /** 请求体上限：64 KiB */
  MAX_BODY_BYTES: 64 * 1024,
  /** 单账号连续登录失败上限与锁定时长 */
  LOGIN_MAX_FAILS: 5,
  LOGIN_LOCK_MS: 60 * 1000,
  /** 开发环境允许跨域，便于前端独立部署；生产应改为具体域名 */
  CORS_ORIGIN: process.env.BLOG_CORS_ORIGIN || '*',
};
