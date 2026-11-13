package com.example.blog.foundation.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import jakarta.servlet.MultipartConfigElement;

/**
 * 在不修改 application.yml 的前提下，把上传单文件上限设为 2 MB（文档 F6 头像规格）。
 *
 * MultipartAutoConfiguration 的 multipartConfigElement() 带 @ConditionalOnMissingBean，
 * 因此本 Bean 会被自动配置识别并跳过默认值；现有 5 个 JSON 接口完全不受影响。
 * 两侧都加条件注解，保证无论配置类解析顺序如何，容器中最多只有一个
 * MultipartConfigElement，不会出现 Bean 歧义或覆盖异常。
 */
@Configuration
public class MultipartConfig {

    public static final long MAX_FILE_SIZE = 2L * 1024 * 1024;
    public static final long MAX_REQUEST_SIZE = 4L * 1024 * 1024;
    private static final int FILE_SIZE_THRESHOLD = 16 * 1024;

    @Bean
    @ConditionalOnMissingBean(MultipartConfigElement.class)
    public MultipartConfigElement p0MultipartConfigElement() {
        return new MultipartConfigElement(
                System.getProperty("java.io.tmpdir"),
                MAX_FILE_SIZE,
                MAX_REQUEST_SIZE,
                FILE_SIZE_THRESHOLD);
    }
}
