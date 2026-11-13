package com.example.blog.web;

import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.service.CommentService;

/** F8 评论端点（§4.2）。列表公开（仅 approved，作者可见全部）；发表需登录；删除限作者/内容作者。 */
@RestController
@RequestMapping("/api")
public class CommentController {

    private final CommentService comments;

    public CommentController(CommentService comments) {
        this.comments = comments;
    }

    @GetMapping("/comments")
    public Map<String, Object> list(
            @RequestParam("target_type") String targetType,
            @RequestParam("target_id") String targetId,
            @RequestParam(value = "page", required = false) String page,
            @RequestParam(value = "size", required = false) String size,
            @RequestParam(value = "sort", required = false) String sort) {
        PageQuery pq = PageQuery.parse(page, size, sort);
        return ApiResponse.success(comments.list(targetType, targetId, AuthContext.userIdOrNull(), pq));
    }

    @PostMapping("/comments")
    public Map<String, Object> create(
            @RequestBody Map<String, Object> body,
            jakarta.servlet.http.HttpServletRequest request) {
        String uid = AuthContext.requireLogin();
        String ip = clientIp(request);
        return ApiResponse.success(comments.create(body, uid, ip));
    }

    @DeleteMapping("/comments/{id}")
    public Map<String, Object> delete(@PathVariable("id") String id) {
        String uid = AuthContext.requireLogin();
        comments.delete(id, uid);
        return ApiResponse.success("已删除");
    }

    private static String clientIp(jakarta.servlet.http.HttpServletRequest r) {
        String fwd = r.getHeader("X-Forwarded-For");
        return fwd != null ? fwd : r.getRemoteAddr();
    }
}
