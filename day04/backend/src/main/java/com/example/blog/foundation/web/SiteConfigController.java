package com.example.blog.foundation.web;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.config.SiteProperties;
import com.example.blog.foundation.repository.SiteConfigStore;
import com.example.blog.foundation.security.AuthContext;

/**
 * F1 / 决策 8：站点公开配置。
 * 匿名可读 —— 无令牌时按访客返回 200（决策 2 / P9），绝不返回 401。
 * visitor 字段同时用于端到端验证「统一鉴权拦截器确实注入了上下文」。
 */
@RestController
public class SiteConfigController {

    private final SiteProperties properties;
    private final SiteConfigStore store;

    public SiteConfigController(SiteProperties properties, SiteConfigStore store) {
        this.properties = properties;
        this.store = store;
    }

    @GetMapping("/api/site/config")
    public Map<String, Object> config() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("siteName", store.find("site.name").orElse(properties.getSiteName()));
        data.put("tagline", store.find("site.tagline").orElse(properties.getTagline()));
        data.put("defaultVisibility", store.find("site.default-visibility")
                .orElse(properties.getDefaultVisibility()));
        data.put("pageSize", parseSize(store.find("site.page-size"), properties.getPageSize()));
        data.put("commentModeration", parseBool(store.find("site.comment-moderation"),
                properties.isCommentModeration()));
        data.put("defaultBackground", "video");
        data.put("visitor", AuthContext.isGuest());
        return ApiResponse.success(data);
    }

    private static int parseSize(Optional<String> raw, int fallback) {
        if (raw.isEmpty()) return fallback;
        try {
            int value = Integer.parseInt(raw.get().trim());
            return (value >= 1 && value <= 50) ? value : fallback;
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    private static boolean parseBool(Optional<String> raw, boolean fallback) {
        if (raw.isEmpty()) return fallback;
        String value = raw.get().trim();
        if ("true".equalsIgnoreCase(value)) return true;
        if ("false".equalsIgnoreCase(value)) return false;
        return fallback;
    }
}
