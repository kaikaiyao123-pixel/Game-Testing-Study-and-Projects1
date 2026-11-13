package com.example.blog.foundation.common;

import com.example.blog.web.ApiException;

/**
 * P0 统一业务异常。
 *
 * 刻意继承既有 web.ApiException，属于降级安全设计：即便本轮的
 * P0ExceptionHandler 因任何原因未装载，既有 GlobalExceptionHandler
 * 仍会按 HTTP 状态返回 {ok:false,message}，不会退化成 500，
 * 也不会改变现有 5 个鉴权 API 的响应契约。
 */
public class BizException extends ApiException {

    private final ErrorCode errorCode;

    public BizException(ErrorCode errorCode) {
        this(errorCode, errorCode.defaultMessage());
    }

    public BizException(ErrorCode errorCode, String message) {
        super(errorCode.httpStatus(), message);
        this.errorCode = errorCode;
    }

    public ErrorCode errorCode() {
        return errorCode;
    }
}
