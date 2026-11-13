package com.example.blog.foundation.common;

/**
 * P0 统一业务错误码表（文档 §8 可观测性：统一业务错误码表）。
 * 后续 F2-F8 所有新增接口一律复用本表，禁止硬编码裸错误消息。
 */
public enum ErrorCode {

    VALIDATION_ERROR(400, "VALIDATION_ERROR", "参数校验失败"),
    UNAUTHORIZED(401, "UNAUTHORIZED", "请先登录"),
    FORBIDDEN(403, "FORBIDDEN", "无权访问"),
    NOT_FOUND(404, "NOT_FOUND", "资源不存在"),
    CONFLICT(409, "CONFLICT", "资源冲突"),
    RATE_LIMITED(429, "RATE_LIMITED", "操作过于频繁"),
    INTERNAL_ERROR(500, "INTERNAL_ERROR", "服务端内部错误");

    private final int httpStatus;
    private final String code;
    private final String defaultMessage;

    ErrorCode(int httpStatus, String code, String defaultMessage) {
        this.httpStatus = httpStatus;
        this.code = code;
        this.defaultMessage = defaultMessage;
    }

    public int httpStatus() {
        return httpStatus;
    }

    public String code() {
        return code;
    }

    public String defaultMessage() {
        return defaultMessage;
    }

    /** 把裸 HTTP 状态收敛到本表，避免错误码散落。 */
    public static ErrorCode fromHttpStatus(int status) {
        for (ErrorCode value : values()) {
            if (value.httpStatus == status) return value;
        }
        return INTERNAL_ERROR;
    }
}
