package com.example.blog.foundation.common;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * P0 统一响应体（文档 §4.1）。
 *
 * 成功：{ ok:true, message?, data }；失败：{ ok:false, message, code }。
 * 现有 5 个鉴权 API 采用「字段平铺」风格，本轮严格零改动予以保留；
 * P0 起的新接口统一使用本类，两种风格在 data 层级隔离，互不干扰。
 */
public final class ApiResponse {

    private ApiResponse() {
    }

    public static Map<String, Object> success(Object data) {
        return success(null, data);
    }

    public static Map<String, Object> success(String message, Object data) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        if (message != null) body.put("message", message);
        body.put("data", data);
        return body;
    }

    public static Map<String, Object> failure(ErrorCode code) {
        return failure(code, null);
    }

    public static Map<String, Object> failure(ErrorCode code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", false);
        body.put("message", message == null ? code.defaultMessage() : message);
        body.put("code", code.code());
        return body;
    }
}
