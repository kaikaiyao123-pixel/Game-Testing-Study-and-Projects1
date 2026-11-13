package com.example.blog.web.dto;

/** 注册请求体。业务校验在 AuthService 中统一完成，与阶段一契约保持一致。 */
public record RegisterRequest(String phone, String nickname, String password) {
}
