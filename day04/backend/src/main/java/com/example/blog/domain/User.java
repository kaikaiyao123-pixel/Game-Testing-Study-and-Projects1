package com.example.blog.domain;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 用户实体。时间统一用 epoch 毫秒（BIGINT）存储，避免 MySQL DATETIME 经
 * JDBC / JVM 时区转换产生 8 小时偏移；对外仍输出 ISO-8601 字符串。
 */
public record User(
        String id,
        String phone,
        String nickname,
        String passwordHash,
        long createdAtMs,
        Long lastLoginAtMs,
        int loginFails,
        long lockedUntilMs) {

    public Map<String, Object> toPublic() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("phone", phone);
        out.put("nickname", nickname);
        out.put("createdAt", Instant.ofEpochMilli(createdAtMs).toString());
        out.put("lastLoginAt", lastLoginAtMs == null
                ? null
                : Instant.ofEpochMilli(lastLoginAtMs).toString());
        return out;
    }
}
