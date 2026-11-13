package com.example.blog.web;

import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.service.ReactionService;

/** F8 点赞 / 收藏端点（§4.2）。状态计数公开；点赞/取消需登录。 */
@RestController
@RequestMapping("/api")
public class ReactionController {

    private final ReactionService reactions;

    public ReactionController(ReactionService reactions) {
        this.reactions = reactions;
    }

    @GetMapping("/reactions")
    public Map<String, Object> getState(
            @RequestParam("target_type") String targetType,
            @RequestParam("target_id") String targetId) {
        return ApiResponse.success(reactions.getState(targetType, targetId, AuthContext.userIdOrNull()));
    }

    @PostMapping("/reactions")
    public Map<String, Object> add(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(reactions.add(
                str(body, "target_type"), str(body, "target_id"), uid, str(body, "type")));
    }

    /**
     * 取消点赞。参数可用 query string 传递，也兼容 JSON 请求体。
     *
     * <p>以 query 为主是刻意的：DELETE 携带请求体在 HTTP 语义上不受保证，
     * 反向代理 / 网关可能直接丢弃 body，导致参数丢失。请求体优先级更高，
     * 仅为兼容既有调用方。
     */
    @DeleteMapping("/reactions")
    public Map<String, Object> remove(
            @RequestParam(value = "target_type", required = false) String targetType,
            @RequestParam(value = "target_id", required = false) String targetId,
            @RequestParam(value = "type", required = false) String type,
            @RequestBody(required = false) Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        String tt = targetType != null ? targetType : str(body, "target_type");
        String ti = targetId != null ? targetId : str(body, "target_id");
        String tp = type != null ? type : str(body, "type");
        if (tt == null || ti == null) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "缺少 target_type 或 target_id");
        }
        return ApiResponse.success(reactions.remove(tt, ti, uid, tp));
    }

    private static String str(Map<String, Object> m, String key) {
        if (m == null) return null;
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
