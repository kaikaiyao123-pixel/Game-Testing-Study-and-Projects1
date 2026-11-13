package com.example.blog.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.markdown.MarkdownUtil;
import com.example.blog.foundation.security.AuthContext;

/**
 * F2 编辑器实时预览：服务端渲染并净化 Markdown，返回安全 HTML（§5.8）。
 *
 * <p>需要登录：这是写侧能力（服务端渲染 + 白名单净化，与文章写入走同一套
 * MarkdownUtil），匿名开放会变成免费的计算资源。前端只在编辑器里调用它。
 */
@RestController
@RequestMapping("/api")
public class MarkdownPreviewController {

    private static final int MAX_LENGTH = 200_000;

    @PostMapping("/markdown/preview")
    public Map<String, Object> preview(@RequestBody Map<String, Object> body) {
        AuthContext.requireLogin();
        Object raw = body == null ? null : body.get("md");
        String md = raw == null ? "" : String.valueOf(raw);
        if (md.length() > MAX_LENGTH) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "预览内容过长");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("html", MarkdownUtil.toHtml(md));
        return ApiResponse.success(data);
    }
}
