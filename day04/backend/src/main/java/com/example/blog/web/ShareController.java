package com.example.blog.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.service.ShareService;

/** F8 分享端点（§4.2）。生成需登录；匿名持 token 可读；撤销限创建者。 */
@RestController
@RequestMapping("/api")
public class ShareController {

    private final ShareService shares;

    public ShareController(ShareService shares) {
        this.shares = shares;
    }

    @PostMapping("/shares")
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        Long expiresIn = toLong(body.get("expires_in"));
        return ApiResponse.success(shares.create(
                str(body, "target_type"), str(body, "target_id"), uid, expiresIn));
    }

    @DeleteMapping("/shares/{id}")
    public Map<String, Object> revoke(@PathVariable("id") String id) {
        String uid = AuthContext.requireLogin();
        shares.revoke(id, uid);
        return ApiResponse.success("已撤销");
    }

    /** 匿名只读分享页数据（§4.2 /api/s/{token}）。公开集合的可选访问口令通过 password 参数传入。 */
    @GetMapping("/s/{token}")
    public Map<String, Object> getByToken(@PathVariable("token") String token,
            @RequestParam(value = "password", required = false) String password) {
        return ApiResponse.success(shares.getByToken(token, password));
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static Long toLong(Object v) {
        if (v == null) return null;
        try {
            return Long.parseLong(String.valueOf(v));
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
