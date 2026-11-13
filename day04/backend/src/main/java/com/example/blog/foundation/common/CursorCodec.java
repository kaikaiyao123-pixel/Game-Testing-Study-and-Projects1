package com.example.blog.foundation.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

/**
 * F5 时间线游标（P6：高频插入用游标分页）。
 * 载荷为 createdAtMs + ":" + id，Base64URL 无填充编码，并附带完整性校验和。
 *
 * 说明：校验和使用常量盐，目标是拦截手工篡改与脏数据，不是抗伪造签名；
 * P2 起若需防伪造，可换为由服务端密钥驱动的 HMAC（届时另增配置，不改本类契约）。
 */
public final class CursorCodec {

    private static final String SALT = "p0-cursor-v1";
    private static final long MAX_TIMESTAMP_MS = 4102444800000L; // 2100-01-01T00:00:00Z
    private static final String ID_PATTERN = "[0-9a-fA-F-]{36}";

    private CursorCodec() {
    }

    public static String encode(long createdAtMs, String id) {
        if (createdAtMs <= 0 || createdAtMs > MAX_TIMESTAMP_MS) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标时间戳越界");
        }
        if (id == null || !id.matches(ID_PATTERN)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标主键格式非法");
        }
        String payload = createdAtMs + ":" + id;
        String raw = payload + ":" + checksum(payload);
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    public static Cursor decode(String cursor) {
        if (cursor == null || cursor.isBlank() || cursor.length() > 256) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标为空或过长");
        }
        final String raw;
        try {
            raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标不是合法 Base64URL");
        }
        String[] parts = raw.split(":", -1);
        if (parts.length != 3 || !parts[1].matches(ID_PATTERN)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标结构非法");
        }
        final long timestampMs;
        try {
            timestampMs = Long.parseLong(parts[0]);
        } catch (NumberFormatException ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标时间戳非法");
        }
        if (timestampMs <= 0 || timestampMs > MAX_TIMESTAMP_MS) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标时间戳越界");
        }
        String expected = checksum(parts[0] + ":" + parts[1]);
        // 恒定时间比较，避免校验和按字节时序泄露
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                parts[2].getBytes(StandardCharsets.UTF_8))) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "游标已损坏或被篡改");
        }
        return new Cursor(timestampMs, parts[1]);
    }

    private static String checksum(String payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest((SALT + "|" + payload).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(12);
            for (int i = 0; i < 6; i++) {
                hex.append(String.format("%02x", bytes[i] & 0xff));
            }
            return hex.toString();
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 不可用", ex);
        }
    }

    public record Cursor(long createdAtMs, String id) {
    }
}
