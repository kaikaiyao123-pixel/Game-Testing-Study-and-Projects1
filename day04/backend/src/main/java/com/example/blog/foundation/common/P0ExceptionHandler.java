package com.example.blog.foundation.common;

import java.util.Map;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * P0 统一异常处理：仅输出带 code 的失败响应。
 *
 * 零回归要点：
 * 1. @Order(HIGHEST_PRECEDENCE) 保证先于既有 GlobalExceptionHandler 命中；
 * 2. 本类不声明任何宽泛的 @ExceptionHandler(Exception.class)。现有 5 个
 *    鉴权 API 抛出的 ApiException 在本类找不到匹配方法，Spring 会继续
 *    交给 GlobalExceptionHandler，响应字段逐字不变；
 * 3. 其余两个 handler 只覆盖上传超限与静态资源未命中，现有接口不会触发这两类异常。
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class P0ExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ResponseEntity<Map<String, Object>> handleBiz(BizException ex) {
        return ResponseEntity.status(ex.getStatus())
                .body(ApiResponse.failure(ex.errorCode(), ex.getMessage()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleTooLarge(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(400)
                .body(ApiResponse.failure(ErrorCode.VALIDATION_ERROR, "上传文件超过大小上限"));
    }

    /**
     * Spring 6.1 的静态资源未命中会抛 NoResourceFoundException，
     * 若不精确处理，会被既有 GlobalExceptionHandler 的 Exception 兜底吞成 500。
     * 本 handler 把它还原为语义正确的 404，且不影响任何既有 API。
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNoResource(NoResourceFoundException ex) {
        return ResponseEntity.status(404)
                .body(ApiResponse.failure(ErrorCode.NOT_FOUND, "资源不存在"));
    }
}
