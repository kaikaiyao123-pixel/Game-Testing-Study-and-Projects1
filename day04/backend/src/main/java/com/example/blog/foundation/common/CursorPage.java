package com.example.blog.foundation.common;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 游标分页出参 { items, nextCursor, hasMore }。调用方多取一条用于判定 hasMore。 */
public final class CursorPage {

    private CursorPage() {
    }

    public static <T> Map<String, Object> of(List<T> items, int size, String nextCursor) {
        boolean hasMore = items.size() > size;
        List<T> visible = hasMore ? new ArrayList<>(items.subList(0, size)) : items;
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", visible);
        body.put("nextCursor", hasMore ? nextCursor : null);
        body.put("hasMore", hasMore);
        return body;
    }
}
