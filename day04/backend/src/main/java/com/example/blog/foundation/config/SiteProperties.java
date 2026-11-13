package com.example.blog.foundation.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 站点配置项（决策 8：品牌名抽为配置，避免登录页 / 主页多处硬编码）。
 *
 * 每个字段都带代码内默认值，因此不改 application.yml 也能工作，满足「严格零改动」。
 * 运行时优先读 site_config 表（V2 迁移脚本建表），表不存在时回退到这里的默认值。
 */
@Component
public class SiteProperties {

    @Value("${blog.site.name:炫与梓}")
    private String siteName = "炫与梓";

    @Value("${blog.site.tagline:记录生活，收藏喜欢}")
    private String tagline = "记录生活，收藏喜欢";

    @Value("${blog.site.default-visibility:public}")
    private String defaultVisibility = "public";

    @Value("${blog.site.page-size:20}")
    private int pageSize = 20;

    @Value("${blog.site.comment-moderation:true}")
    private boolean commentModeration = true;

    public String getSiteName() {
        return siteName;
    }

    public String getTagline() {
        return tagline;
    }

    public String getDefaultVisibility() {
        return defaultVisibility;
    }

    public int getPageSize() {
        return pageSize;
    }

    public boolean isCommentModeration() {
        return commentModeration;
    }
}
