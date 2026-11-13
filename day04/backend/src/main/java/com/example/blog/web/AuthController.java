package com.example.blog.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.service.AuthService;
import com.example.blog.web.dto.LoginRequest;
import com.example.blog.web.dto.RegisterRequest;

/** REST API 层。响应体与阶段一 Node 版逐字段对齐，前端无需改动。 */
@RestController
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return auth.health();
    }

    @PostMapping("/api/register")
    public ResponseEntity<Map<String, Object>> register(
            @RequestBody RegisterRequest request,
            @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
            jakarta.servlet.http.HttpServletRequest servletRequest) {
        String ip = forwardedFor != null ? forwardedFor : servletRequest.getRemoteAddr();
        Map<String, Object> body = success("注册成功");
        body.putAll(auth.register(request, ip));
        return ResponseEntity.status(HttpStatus.CREATED).body(body);
    }

    @PostMapping("/api/login")
    public Map<String, Object> login(
            @RequestBody LoginRequest request,
            @RequestHeader(value = "User-Agent", required = false) String userAgent,
            @RequestHeader(value = "X-Forwarded-For", required = false) String forwardedFor,
            jakarta.servlet.http.HttpServletRequest servletRequest) {
        String ip = forwardedFor != null ? forwardedFor : servletRequest.getRemoteAddr();
        Map<String, Object> body = success("登录成功");
        body.putAll(auth.login(request, userAgent, ip));
        return body;
    }

    @GetMapping("/api/me")
    public Map<String, Object> me(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Map<String, Object> body = success(null);
        body.putAll(auth.me(bearer(authorization)));
        return body;
    }

    @PostMapping("/api/logout")
    public Map<String, Object> logout(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        auth.logout(bearer(authorization));
        Map<String, Object> body = success("已退出登录");
        body.put("ok", true);
        return body;
    }

    private static Map<String, Object> success(String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", true);
        if (message != null) body.put("message", message);
        return body;
    }

    private static String bearer(String header) {
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) return null;
        return header.substring(7).trim();
    }
}
