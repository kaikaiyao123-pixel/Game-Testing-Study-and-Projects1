package com.example.blog.web.dto;

/** 登录请求体。remember 可选：true 表示「记住我」（30 天滑动会话），缺省为 12 小时会话。 */
public record LoginRequest(String phone, String password, Boolean remember) {
}
