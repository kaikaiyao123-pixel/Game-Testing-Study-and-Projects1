package com.example.blog.web;

import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.service.MomentService;

/** F5 碎碎念端点（§4.2）。时间线匿名可读；发布/编辑/删除限作者。 */
@RestController
@RequestMapping("/api")
public class MomentController {

    private static final int DEFAULT_SIZE = 20;
    private static final int MAX_SIZE = 100;

    private final MomentService moments;

    public MomentController(MomentService moments) {
        this.moments = moments;
    }

    @GetMapping("/moments")
    public Map<String, Object> timeline(
            @RequestParam(value = "before", required = false) String before,
            @RequestParam(value = "size", required = false) String size) {
        int s = parseSize(size);
        return ApiResponse.success(moments.timeline(before, s, AuthContext.userIdOrNull()));
    }

    @PostMapping("/moments")
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(moments.create(body, uid));
    }

    @PatchMapping("/moments/{id}")
    public Map<String, Object> update(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(moments.update(id, uid, body));
    }

    @DeleteMapping("/moments/{id}")
    public Map<String, Object> delete(@PathVariable("id") String id) {
        String uid = AuthContext.requireLogin();
        moments.delete(id, uid);
        return ApiResponse.success("已删除");
    }

    @GetMapping("/moments/archive")
    public Map<String, Object> archive() {
        return ApiResponse.success(moments.archive(AuthContext.userIdOrNull()));
    }

    private static int parseSize(String s) {
        int n = DEFAULT_SIZE;
        if (s != null && !s.isBlank()) {
            try {
                n = Integer.parseInt(s.trim());
            } catch (NumberFormatException ex) {
                n = DEFAULT_SIZE;
            }
        }
        return Math.max(1, Math.min(MAX_SIZE, n));
    }
}
