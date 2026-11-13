package com.example.blog.domain;

/** 登录审计记录（F0-5）。落库用于 F7 展示与异常排查。 */
public record LoginLog(
        String id,
        String userId,
        String phone,
        String ip,
        String userAgent,
        String result,
        String reason,
        long createdAtMs) {
}
