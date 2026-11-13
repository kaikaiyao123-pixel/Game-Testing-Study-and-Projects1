package com.example.blog.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 未知 /api 路径统一返回 JSON 404，保持与阶段一 Node 版一致的契约。 */
@RestController
public class ApiFallbackController {

    @RequestMapping(value = {"/api", "/api/{*path}"})
    public ResponseEntity<Map<String, Object>> unknown() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", false);
        body.put("message", "接口不存在");
        return ResponseEntity.status(404).body(body);
    }
}
