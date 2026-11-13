package com.example.blog.foundation.config;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.example.blog.foundation.security.AuthContextInterceptor;

/**
 * P0 地基装配：注册统一鉴权拦截器与上传文件静态资源映射。
 *
 * 与既有 CorsConfig 同为 WebMvcConfigurer，Spring 会合并全部配置类，
 * 既有 /api/** 的 CORS 规则保持原样（GET/POST/OPTIONS 恰好覆盖 P0 端点）。
 * 不修改任何既有配置类。
 */
@Configuration
public class P0WebConfig implements WebMvcConfigurer {

    private final AuthContextInterceptor interceptor;
    private final String uploadDir;

    public P0WebConfig(AuthContextInterceptor interceptor,
                       @Value("${blog.upload.dir:data/uploads}") String uploadDir) {
        this.interceptor = interceptor;
        this.uploadDir = uploadDir;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 仅对 /api/** 注入上下文；/uploads/** 静态资源不经过拦截器
        registry.addInterceptor(interceptor).addPathPatterns("/api/**");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        Path dir = Paths.get(uploadDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(dir);
        } catch (Exception ignored) {
            // 目录创建失败时后续上传会返回明确错误，不影响应用启动
        }
        String uri = dir.toUri().toString();
        if (!uri.endsWith("/")) uri = uri + "/";
        registry.addResourceHandler("/uploads/**")
                .addResourceLocations(uri)
                .setCachePeriod(3600);
    }
}
