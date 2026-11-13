package com.example.blog.foundation.common;

import java.util.Locale;
import java.util.Set;

/**
 * P6 统一分页入参：page 从 1，size 默认 20 / 上限 50，sort 走白名单。
 * 白名单是安全边界：sort 最终会进入 SQL ORDER BY，绝不接受任意列名的字符串。
 */
public final class PageQuery {

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 50;

    private static final String DEFAULT_SORT = "created_at_ms:desc";
    private static final Set<String> ALLOWED_SORTS = Set.of(
            "created_at_ms:desc", "created_at_ms:asc",
            "published_at_ms:desc", "published_at_ms:asc",
            "updated_at_ms:desc", "updated_at_ms:asc",
            "sort_order:asc", "sort_order:desc");

    private final int page;
    private final int size;
    private final String sort;

    private PageQuery(int page, int size, String sort) {
        this.page = page;
        this.size = size;
        this.sort = sort;
    }

    /**
     * 宽松解析：缺省 / 非数值一律收敛到默认值；仅 sort 白名单外的值抛 400。
     *
     * <p>sort 是唯一严格校验的字段：它最终决定 ORDER BY，显式报错能让
     * 调用方尽早发现拼错的排序参数，也把「注入尝试必须被拒绝」固化为契约
     * （见 P0FoundationTest#pageQueryRejectsSortOutsideWhitelist）。
     */
    public static PageQuery parse(String rawPage, String rawSize, String rawSort) {
        int page = positiveInt(rawPage, 1);
        int size = positiveInt(rawSize, DEFAULT_SIZE);
        if (size > MAX_SIZE) size = MAX_SIZE;
        String sort = (rawSort == null || rawSort.isBlank()) ? DEFAULT_SORT : rawSort.trim();
        if (!ALLOWED_SORTS.contains(sort)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "不支持的排序参数: " + sort);
        }
        return new PageQuery(page, size, sort);
    }

    private static int positiveInt(String raw, int fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            long value = Long.parseLong(raw.trim());
            if (value < 1 || value > Integer.MAX_VALUE) return fallback;
            return (int) value;
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    public int page() {
        return page;
    }

    public int size() {
        return size;
    }

    public String sort() {
        return sort;
    }

    /**
     * 可直接拼进 SQL ORDER BY 的安全片段，形如 {@code created_at_ms DESC}。
     *
     * <p>sort() 返回的是「列名:方向」这种声明式格式，冒号是非法 SQL 语法，
     * 不能直接进 SQL。本方法把已通过白名单校验的值拆成「列名 + 大写方向」，
     * 二者均来自 ALLOWED_SORTS 的字面量，不含任何用户可控内容，
     * 因此拼接是安全的（白名单即安全边界）。
     */
    public String orderBy() {
        int sep = sort.indexOf(':');
        String column = sep < 0 ? sort : sort.substring(0, sep);
        String direction = sep < 0 ? "DESC" : sort.substring(sep + 1).toUpperCase(Locale.ROOT);
        return column + " " + direction;
    }

    public long offset() {
        return (long) (page - 1) * size;
    }
}
