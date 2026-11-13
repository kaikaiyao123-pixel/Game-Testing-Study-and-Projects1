package com.example.blog.web;

/** 业务异常：携带 HTTP 状态码，由 GlobalExceptionHandler 统一转成 JSON。 */
public class ApiException extends RuntimeException {

    private final int status;

    public ApiException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int getStatus() {
        return status;
    }
}
