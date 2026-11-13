package com.example.blog.foundation.common;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * P3 数据层小工具：把 JDBC 行的下划线列名转成 camelCase 的 LinkedHashMap。
 *
 * 只做「读取」，不做「输出」：所有对外接口仍由各 Service 用白名单字段显式组装，
 * 因此绝不会因为多查了一列就把内部字段（如口令散列、访问口令）泄露给客户端。
 * SQL 依旧全部参数化，列名来自 ResultSetMetaData，不含任何用户可控内容。
 */
public final class RowMap {

    private RowMap() {
    }

    public static Map<String, Object> of(ResultSet rs) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        Map<String, Object> row = new LinkedHashMap<>();
        for (int i = 1; i <= meta.getColumnCount(); i++) {
            row.put(camel(meta.getColumnLabel(i)), rs.getObject(i));
        }
        return row;
    }

    public static String camel(String name) {
        if (name == null || name.isEmpty()) return name;
        StringBuilder out = new StringBuilder();
        boolean upperNext = false;
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == '_') {
                upperNext = true;
            } else if (upperNext) {
                out.append(Character.toUpperCase(c));
                upperNext = false;
            } else {
                out.append(Character.toLowerCase(c));
            }
        }
        return out.toString();
    }

    public static String str(Map<String, Object> row, String key) {
        Object v = row.get(key);
        return v == null ? null : String.valueOf(v);
    }

    public static long lng(Map<String, Object> row, String key) {
        Object v = row.get(key);
        if (v instanceof Number n) return n.longValue();
        return 0L;
    }

    public static int integer(Map<String, Object> row, String key) {
        Object v = row.get(key);
        if (v instanceof Number n) return n.intValue();
        return 0;
    }

    public static boolean bool(Map<String, Object> row, String key) {
        Object v = row.get(key);
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.intValue() != 0;
        return false;
    }
}
