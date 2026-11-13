package com.example.blog.foundation.common;

import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * P3：把「字符串数组」字段（tags / images）以 JSON 文本存入 MySQL，
 * 避免为短数组再建关联表。写入前做数量与长度白名单校验，读取失败返回空数组。
 */
public final class JsonFields {

    private JsonFields() {
    }

    public static String encode(ObjectMapper mapper, Object raw, int maxCount, int maxLength, String label) {
        if (raw == null) return "[]";
        if (!(raw instanceof List<?> list)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, label + "必须是数组");
        }
        if (list.size() > maxCount) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, label + "最多 " + maxCount + " 项");
        }
        List<String> clean = new ArrayList<>();
        for (Object o : list) {
            String s = o == null ? "" : String.valueOf(o).trim();
            if (s.length() > maxLength) {
                throw new BizException(ErrorCode.VALIDATION_ERROR, label + "单项不超过 " + maxLength + " 字");
            }
            clean.add(s);
        }
        try {
            return mapper.writeValueAsString(clean);
        } catch (Exception ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, label + "格式非法");
        }
    }

    public static List<String> decode(ObjectMapper mapper, Object raw) {
        if (raw == null) return new ArrayList<>();
        try {
            return mapper.readValue(String.valueOf(raw), new TypeReference<List<String>>() {
            });
        } catch (Exception ex) {
            return new ArrayList<>();
        }
    }
}
