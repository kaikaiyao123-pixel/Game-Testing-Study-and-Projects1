package com.example.blog.foundation.common;

import com.example.blog.repository.UserPreferenceRepository;

/**
 * P3：把 F7「每页条数」用户偏好接入内容列表接口。
 *
 * 兼容性设计：只有「客户端未显式传 size」且「已登录」时才读用户偏好；
 * 未设置偏好的账号回退到 Table 默认值 20，因此既有验收脚本的分页断言零回归。
 * 所有 SQL 仍然只使用 PageQuery.orderBy()，不拼接任何客户端字符串。
 */
public final class PageSupport {

    private PageSupport() {
    }

    public static PageQuery parse(String page, String size, String sort, String viewerId,
                                  UserPreferenceRepository prefs) {
        if ((size == null || size.isBlank()) && viewerId != null && prefs != null) {
            int preferred = prefs.pageSize(viewerId);
            if (preferred > 0 && preferred <= PageQuery.MAX_SIZE) {
                return PageQuery.parse(page, String.valueOf(preferred), sort);
            }
        }
        return PageQuery.parse(page, size, sort);
    }
}
