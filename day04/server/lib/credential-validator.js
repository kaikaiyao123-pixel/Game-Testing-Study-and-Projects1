'use strict';

/**
 * 登录 / 注册凭证校验（Node 侧唯一入口）。
 *
 * 安全目标：
 *  1. 长度统一 8~16 —— 密码 8~16 位；手机号固定 11 位纯数字（同处 8~16 区间）；
 *     注册与登录使用同一套规则，避免「注册严、登录松」的绕过面。
 *  2. 防 SQL 注入 —— 进入 SQL 的字段（手机号 / 昵称）走「数字或字符白名单 +
 *     注入特征拒绝」双重校验；密码永不以明文进入 SQL（scrypt 哈希后仅存十六进制），
 *     故不对密码做 SQL 字符黑名单，避免削弱口令空间（对密码做黑名单是反模式）。
 *     数据库访问侧全部使用 JdbcTemplate 的 ? 占位符 / JSON 仓储，不存在字符串拼接。
 *  3. 类型与字节安全 —— 拒绝非字符串字段（杜绝 String(obj) 强转绕过）、控制字符
 *     （日志注入 / 头部注入 / NUL 截断），并在昂贵的哈希计算之前完成廉价的长度校验。
 *
 * 所有失败统一抛 httpError(400, ...)，且不回显原始输入，避免反射与日志污染。
 * 规则与 backend/.../security/CredentialValidator.java 逐条对齐，保证两阶段契约一致。
 */
const { httpError } = require('./http-utils');

const PHONE_LENGTH = 11;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 16;
const NICKNAME_MIN = 1;
const NICKNAME_MAX = 24;

const PHONE_RE = /^1[3-9]\d{9}$/;
/** 昵称白名单：Unicode 字母/数字 + 空格 _ . -；天然排除引号、分号、括号、等号等元字符 */
const NICKNAME_RE = /^[\p{L}\p{N} _.-]+$/u;
/** C0/C1 控制字符，含 NUL、CR/LF、TAB、DEL */
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
/** SQL 注入特征：元字符、注释、布尔/联合/时间盲注片段（大小写不敏感） */
const SQL_INJECTION_RE = /['"`;]|--|\/\*|\*\/|#|=|\b(?:or|and)\s+\d+\s*=\s*\d+|\bunion\s+select\b|\bdrop\s+table\b|\bsleep\s*\(|\bbenchmark\s*\(|\bxp_cmdshell\b|\binformation_schema\b/i;

/** 按 Unicode 码点计数，与 Java 的 codePointCount 对齐（emoji 计 1 个字符）。 */
function codePoints(value) {
  return Array.from(value).length;
}

/** 供验收脚本做正反向断言：字符串是否命中 SQL 注入特征。 */
function hasSqlInjectionPattern(value) {
  return typeof value === 'string' && SQL_INJECTION_RE.test(value);
}

/**
 * 字段必须是字符串。字段缺失（null/undefined）视为空值，交由后续格式/长度校验
 * 给出原有错误文案；对象、数组、数字、布尔等一律拒绝，避免 String() 强转绕过。
 */
function requirePlainString(value, field) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') {
    throw httpError(400, `${field} 必须为字符串`);
  }
  if (CONTROL_RE.test(value)) {
    throw httpError(400, `${field} 含非法控制字符`);
  }
  return value;
}

/** 显式注入特征拒绝（纵深防御，且让防护意图可审计、可验收）。 */
function assertNoSqlInjection(value, field) {
  if (hasSqlInjectionPattern(value)) {
    throw httpError(400, `${field} 含非法字符，请检查输入`);
  }
}

function normalizePhone(value) {
  const phone = requirePlainString(value, '手机号').trim();
  if (!PHONE_RE.test(phone)) {
    throw httpError(400, '手机号格式不正确，需为 11 位中国大陆手机号');
  }
  // 纯数字白名单已天然免疫注入，此处保留显式检查以便统一审计口径
  assertNoSqlInjection(phone, '手机号');
  return phone;
}

function validatePassword(value) {
  const password = requirePlainString(value, '密码');
  if (password.length === 0) {
    throw httpError(400, '请输入密码');
  }
  const len = codePoints(password);
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) {
    throw httpError(400, `密码长度需在 ${PASSWORD_MIN}~${PASSWORD_MAX} 位之间`);
  }
  // 密码不做 SQL 字符黑名单：哈希后的十六进制串才入库，参数化查询保证无注入面。
  return password;
}

function validateNickname(value) {
  const nickname = requirePlainString(value, '昵称').trim();
  const len = codePoints(nickname);
  if (len < NICKNAME_MIN || len > NICKNAME_MAX) {
    throw httpError(400, '昵称长度需在 1~24 个字符之间');
  }
  assertNoSqlInjection(nickname, '昵称');
  if (!NICKNAME_RE.test(nickname)) {
    throw httpError(400, '昵称仅支持中文、字母、数字及空格 _ . -');
  }
  return nickname;
}

/** 注册入参：返回规范化后的三元组，任何不合法输入抛 400。 */
function validateRegister(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, '请求体必须为 JSON 对象');
  }
  return {
    phone: normalizePhone(body.phone),
    nickname: validateNickname(body.nickname),
    password: validatePassword(body.password),
  };
}

/** 登录入参：与注册共用长度规则，杜绝只在一侧收紧的绕过。 */
function validateLogin(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, '请求体必须为 JSON 对象');
  }
  return {
    phone: normalizePhone(body.phone),
    password: validatePassword(body.password),
  };
}

module.exports = {
  PHONE_LENGTH,
  PASSWORD_MIN,
  PASSWORD_MAX,
  NICKNAME_MIN,
  NICKNAME_MAX,
  PHONE_RE,
  NICKNAME_RE,
  CONTROL_RE,
  SQL_INJECTION_RE,
  hasSqlInjectionPattern,
  normalizePhone,
  validatePassword,
  validateNickname,
  validateRegister,
  validateLogin,
};
