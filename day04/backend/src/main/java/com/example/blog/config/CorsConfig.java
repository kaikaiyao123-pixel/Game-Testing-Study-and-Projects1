package com.example.blog.config;

import java.util.Arrays;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 前后端分离：前端独立部署在 3000 端口，后端只开放 /api/** 的跨域访问。
 * 生产环境应把 CORS_ALLOWED_ORIGINS 改成具体域名，不要使用 *。
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final String allowedOrigins;

    public CorsConfig(@Value("${blog.cors.allowed-origins:*}") String allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String[] origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .toArray(String[]::new);

        CorsRegistration registration = registry.addMapping("/api/**");
        if (origins.length == 0 || (origins.length == 1 && "*".equals(origins[0]))) {
            registration.allowedOriginPatterns("*");
        } else {
            registration.allowedOrigins(origins);
        }
        registration
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "Authorization")
                .maxAge(600);
    }
}
