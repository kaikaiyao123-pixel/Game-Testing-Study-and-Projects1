package com.example.blog.foundation.common;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** P6 统一分页出参 { items, total, page, size, hasMore }。 */
public final class PageResult {

    private PageResult() {
    }

    public static <T> Map<String, Object> of(List<T> items, long total, PageQuery query) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("total", total);
        body.put("page", query.page());
        body.put("size", query.size());
        body.put("hasMore", query.offset() + items.size() < total);
        return body;
    }
}
