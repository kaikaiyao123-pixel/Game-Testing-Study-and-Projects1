package com.example.blog.security;

import java.util.regex.Pattern;

import com.example.blog.web.ApiException;
import com.example.blog.web.dto.LoginRequest;
import com.example.blog.web.dto.RegisterRequest;

/**
 * 登录 / 注册凭证校验（Spring Boot 侧唯一入口），与阶段一 Node 版规则逐条对齐。
 *
 * 安全目标：
 *  1. 长度统一 8~16 —— 密码 8~16 位；手机号固定 11 位纯数字（同处 8~16 区间）；
 *     注册与登录共用同一套规则，避免「注册严、登录松」的绕过面。
 *  2. 防 SQL 注入 —— 进入 SQL 的字段（手机号 / 昵称）走「数字或字符白名单 +
 *     注入特征拒绝」双重校验；密码永不以明文进入 SQL（PBKDF2 哈希后仅存十六进制），
 *     故不对密码做 SQL 字符黑名单，避免削弱口令空间。
 *     UserRepository 的所有语句均使用 JdbcTemplate 的 ? 占位符，无字符串拼接。
 *  3. 类型与字节安全 —— Jackson 绑定阶段已保证字段为 String（非字符串 JSON 值由
 *     HttpMessageNotReadableException 转 400）；此处再拒绝控制字符，防日志/头部注入，
 *     并在昂贵的 PBKDF2 计算之前完成廉价长度校验。
 *
 * 所有失败统一抛 ApiException(400, ...)，且不回显原始输入。
 */
public final class CredentialValidator {

    public static final int PHONE_LENGTH = 11;
    public static final int PASSWORD_MIN = 8;
    public static final int PASSWORD_MAX = 16;
    public static final int NICKNAME_MIN = 1;
    public static final int NICKNAME_MAX = 24;

    private static final Pattern PHONE = Pattern.compile("^1[3-9]\\d{9}$");
    private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x1F\\x7F-\\x9F]");
    /** 昵称白名单：Unicode 字母/数字 + 空格 _ . -；天然排除引号、分号、括号、等号等元字符 */
    private static final Pattern NICKNAME_ALLOWED =
            Pattern.compile("^[\\p{L}\\p{N} _.\\-]+$", Pattern.UNICODE_CHARACTER_CLASS);
    /** SQL 注入特征：元字符、注释、布尔/联合/时间盲注片段（大小写不敏感） */
    private static final Pattern SQL_INJECTION = Pattern.compile(
            "['\"`;]|--|/\\*|\\*/|#|=|\\b(?:or|and)\\s+\\d+\\s*=\\s*\\d+"
                    + "|\\bunion\\s+select\\b|\\bdrop\\s+table\\b|\\bsleep\\s*\\("
                    + "|\\bbenchmark\\s*\\(|\\bxp_cmdshell\\b|\\binformation_schema\\b",
            Pattern.CASE_INSENSITIVE);

    private CredentialValidator() {
    }

    /** 供审计直接调用：判断字符串是否命中 SQL 注入特征。 */
    public static boolean hasSqlInjectionPattern(String value) {
        return value != null && SQL_INJECTION.matcher(value).find();
    }

    /** 按 Unicode 码点计数，与 Node 的 Array.from().length 对齐。 */
    private static int length(String value) {
        return value.codePointCount(0, value.length());
    }

    /** 字段缺失视为空值，交由后续格式/长度校验；控制字符一律拒绝。 */
    private static String requirePlainString(String value, String field) {
        if (value == null) return "";
        if (CONTROL.matcher(value).find()) {
            throw new ApiException(400, field + " 含非法控制字符");
        }
        return value;
    }

    /** 显式注入特征拒绝（纵深防御，且让防护意图可审计、可验收）。 */
    private static void assertNoSqlInjection(String value, String field) {
        if (hasSqlInjectionPattern(value)) {
            throw new ApiException(400, field + " 含非法字符，请检查输入");
        }
    }

    public static String normalizePhone(String value) {
        String phone = requirePlainString(value, "手机号").trim();
        if (!PHONE.matcher(phone).matches()) {
            throw new ApiException(400, "手机号格式不正确，需为 11 位中国大陆手机号");
        }
        // 纯数字白名单已天然免疫注入，此处保留显式检查以便统一审计口径
        assertNoSqlInjection(phone, "手机号");
        return phone;
    }

    public static String validatePassword(String value) {
        String password = requirePlainString(value, "密码");
        if (password.isEmpty()) {
            throw new ApiException(400, "请输入密码");
        }
        int len = length(password);
        if (len < PASSWORD_MIN || len > PASSWORD_MAX) {
            throw new ApiException(400, "密码长度需在 " + PASSWORD_MIN + "~" + PASSWORD_MAX + " 位之间");
        }
        // 密码不做 SQL 字符黑名单：哈希后的十六进制串才入库，参数化查询保证无注入面。
        return password;
    }

    public static String validateNickname(String value) {
        String nickname = requirePlainString(value, "昵称").trim();
        int len = length(nickname);
        if (len < NICKNAME_MIN || len > NICKNAME_MAX) {
            throw new ApiException(400, "昵称长度需在 1~24 个字符之间");
        }
        assertNoSqlInjection(nickname, "昵称");
        if (!NICKNAME_ALLOWED.matcher(nickname).matches()) {
            throw new ApiException(400, "昵称仅支持中文、字母、数字及空格 _ . -");
        }
        return nickname;
    }

    /** 注册入参：返回规范化后的三元组，任何不合法输入抛 400。 */
    public static RegisterInput validateRegister(RegisterRequest request) {
        if (request == null) throw new ApiException(400, "请求体必须为 JSON 对象");
        return new RegisterInput(
                normalizePhone(request.phone()),
                validateNickname(request.nickname()),
                validatePassword(request.password()));
    }

    /** 登录入参：与注册共用长度规则，杜绝只在一侧收紧的绕过。 */
    public static LoginInput validateLogin(LoginRequest request) {
        if (request == null) throw new ApiException(400, "请求体必须为 JSON 对象");
        return new LoginInput(
                normalizePhone(request.phone()),
                validatePassword(request.password()));
    }

    public record RegisterInput(String phone, String nickname, String password) {
    }

    public record LoginInput(String phone, String password) {
    }
}
