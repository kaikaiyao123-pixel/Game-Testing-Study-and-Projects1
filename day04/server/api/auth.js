'use strict';

/**
 * 认证领域逻辑：注册 / 真登录 / 会话校验 / 登出。
 *
 * 「真登录」体现在三点：
 *  1. 密码不以明文保存，使用 scrypt + 随机盐哈希，校验走恒定时间比较；
 *  2. 凭据由服务端查库校验，不依赖前端判断；
 *  3. 校验通过后签发服务端有状态会话，后续 /api/me 必须凭令牌查会话才放行，
 *     登出会真正删除会话（令牌随即失效）。
 *
 * 入参校验统一委托 lib/credential-validator.js（长度 8~16、类型/控制字符、
 * SQL 注入特征拒绝），本文件只负责哈希、持久化与会话生命周期。
 */
const config = require('../config');
const { createJsonStore } = require('../lib/store');
const { hashPassword, verifyPassword, newToken, newId } = require('../lib/crypto');
const { httpError } = require('../lib/http-utils');
const { validateRegister, validateLogin } = require('../lib/credential-validator');

const users = createJsonStore(config.USERS_FILE, { users: [] });
const sessions = createJsonStore(config.SESSIONS_FILE, { sessions: [] });

/** 用于「账号不存在」时仍执行一次哈希计算，避免时序侧信道枚举账号 */
const DUMMY_HASH_PROMISE = hashPassword('timing-safe-dummy-password');

function publicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    nickname: user.nickname,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function iso(ms) {
  return new Date(ms).toISOString();
}

async function register(body) {
  const { phone, nickname, password } = validateRegister(body);

  // 先做哈希再做唯一性写入，缩短持锁时间
  const passwordHash = await hashPassword(password);
  const now = iso(Date.now());

  const user = await users.mutate((data) => {
    if (!Array.isArray(data.users)) data.users = [];
    if (data.users.some((item) => item.phone === phone)) {
      throw httpError(409, '该手机号已注册，请直接登录');
    }
    const created = {
      id: newId(),
      phone,
      nickname,
      passwordHash,
      createdAt: now,
      lastLoginAt: null,
      loginFails: 0,
      lockedUntil: 0,
    };
    data.users.push(created);
    return created;
  });

  return { user: publicUser(user) };
}

async function login(body, meta) {
  const { phone, password } = validateLogin(body);

  const snapshot = await users.read();
  const found = (snapshot.users || []).find((item) => item.phone === phone);
  const hashedToVerify = found ? found.passwordHash : await DUMMY_HASH_PROMISE;
  const passwordOk = await verifyPassword(password, hashedToVerify);
  const genericError = httpError(401, '手机号或密码错误');

  if (!passwordOk) {
    if (found) {
      await users.mutate((data) => {
        const current = (data.users || []).find((item) => item.id === found.id);
        if (!current) return;
        current.loginFails = (current.loginFails || 0) + 1;
        if (current.loginFails >= config.LOGIN_MAX_FAILS) {
          current.lockedUntil = Date.now() + config.LOGIN_LOCK_MS;
        }
      });
    }
    throw genericError;
  }

  if (!found) throw genericError;

  if (found.lockedUntil && Date.now() < found.lockedUntil) {
    const seconds = Math.ceil((found.lockedUntil - Date.now()) / 1000);
    throw httpError(423, `登录失败次数过多，请于 ${seconds} 秒后重试`);
  }

  let currentUser;
  await users.mutate((data) => {
    const current = (data.users || []).find((item) => item.id === found.id);
    if (!current) throw httpError(401, '账号不存在，请重新注册');
    current.loginFails = 0;
    current.lockedUntil = 0;
    current.lastLoginAt = iso(Date.now());
    currentUser = current;
  });

  const now = Date.now();
  const session = {
    token: newToken(),
    userId: found.id,
    createdAt: iso(now),
    expireAt: now + config.SESSION_TTL_MS,
    userAgent: String(meta.userAgent || '').slice(0, 200),
    ip: String(meta.ip || '').slice(0, 64),
  };

  await sessions.mutate((data) => {
    if (!Array.isArray(data.sessions)) data.sessions = [];
    // 顺带清理过期会话
    data.sessions = data.sessions.filter((item) => Date.now() < item.expireAt);
    data.sessions.push(session);
  });

  return {
    token: session.token,
    expiresAt: iso(session.expireAt),
    user: publicUser(currentUser),
  };
}

async function resolveSession(token) {
  if (!token) return null;

  const sessionSnapshot = await sessions.read();
  const session = (sessionSnapshot.sessions || []).find((item) => item.token === token);
  if (!session) return null;

  if (Date.now() >= session.expireAt) {
    await sessions.mutate((data) => {
      data.sessions = (data.sessions || []).filter((item) => item.token !== token);
    });
    return null;
  }

  const userSnapshot = await users.read();
  const user = (userSnapshot.users || []).find((item) => item.id === session.userId);
  if (!user) return null;

  return { session, user };
}

async function me(token) {
  const resolved = await resolveSession(token);
  if (!resolved) {
    throw httpError(401, '登录状态无效或已过期，请重新登录');
  }
  return {
    user: publicUser(resolved.user),
    session: {
      createdAt: resolved.session.createdAt,
      expiresAt: iso(resolved.session.expireAt),
    },
  };
}

async function logout(token) {
  if (!token) return { ok: true };
  await sessions.mutate((data) => {
    data.sessions = (data.sessions || []).filter((item) => item.token !== token);
  });
  return { ok: true };
}

async function stats() {
  const [userData, sessionData] = await Promise.all([users.read(), sessions.read()]);
  return {
    userCount: (userData.users || []).length,
    activeSessionCount: (sessionData.sessions || []).filter(
      (item) => Date.now() < item.expireAt
    ).length,
    dataDir: config.DATA_DIR,
  };
}

module.exports = { register, login, me, logout, stats };
