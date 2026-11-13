package com.example.blog.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.JsonFields;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.PageResult;
import com.example.blog.foundation.common.RowMap;
import com.example.blog.foundation.security.ReadGuard;
import com.example.blog.repository.MediaRepository;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * F3 影视资源：纯文本外链索引 + 观看记录。
 *
 * 合规硬约束：本模块没有任何「文件本体」字段、不写 uploads 目录、不生成播放源、
 * 不对外链做自动解析或跳转；external_url 仅作为文本保存与展示，页面需自行加免责说明。
 */
@Service
public class MediaService {

    private static final List<String> TYPES = List.of("movie", "series", "anime", "documentary");
    private static final List<String> WATCH = List.of("want", "watching", "watched");
    private static final List<String> LINK = List.of("unchecked", "valid", "invalid");

    private final MediaRepository repo;
    private final ObjectMapper mapper;

    public MediaService(MediaRepository repo, ObjectMapper mapper) {
        this.repo = repo;
        this.mapper = mapper;
    }

    public Map<String, Object> list(Map<String, String> params, PageQuery q, String viewerId) {
        Map<String, Object> f = new LinkedHashMap<>();
        boolean mine = "1".equals(params.get("mine")) || "true".equalsIgnoreCase(params.get("mine"));
        f.put("mine", mine && viewerId != null);
        f.put("ownerId", viewerId);
        f.put("type", params.get("type"));
        f.put("year", intOrNull(params.get("year")));
        f.put("watchStatus", params.get("watch_status"));
        f.put("linkStatus", params.get("link_status"));
        f.put("ratingMin", intOrNull(params.get("rating")));
        f.put("q", params.get("q"));

        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : repo.list(f, q)) items.add(view(row));
        return PageResult.of(items, repo.count(f), q);
    }

    public Map<String, Object> get(String id, String viewerId) {
        Map<String, Object> row = repo.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "资源不存在"));
        ReadGuard.require(RowMap.str(row, "visibility"), RowMap.str(row, "ownerId"), viewerId);
        return view(row);
    }

    public Map<String, Object> create(Map<String, Object> body, String ownerId) {
        String title = required(body, "title", 200, "标题为必填，且不超过 200 字");
        String type = enumValue(body, "type", TYPES, "movie");
        int year = yearValue(body.get("year"));
        String visibility = enumValue(body, "visibility", List.of("public", "private"), "public");
        String watchStatus = enumValue(body, "watch_status", WATCH, "want");
        String externalUrl = optionalUrl(body.get("external_url"), 1024, "外链 URL");

        if (repo.businessExists(title, year, type, null)) {
            throw new BizException(ErrorCode.CONFLICT, "同名同年份同类型条目已存在");
        }
        long now = System.currentTimeMillis();
        Map<String, Object> row = baseRow(body, ownerId, title, type, year, visibility, watchStatus, externalUrl);
        row.put("id", repo.nextId());
        row.put("createdAtMs", now);
        row.put("updatedAtMs", now);
        row.put("deletedAtMs", null);
        row.put("linkStatus", LINK.contains(String.valueOf(body.getOrDefault("link_status", "unchecked")))
                ? String.valueOf(body.getOrDefault("link_status", "unchecked")) : "unchecked");
        row.put("linkCheckedAtMs", null);
        row.put("linkRecheckAfterMs", 0L);
        row.put("linkFailCount", 0);
        try {
            repo.insert(row);
        } catch (DuplicateKeyException ex) {
            throw new BizException(ErrorCode.CONFLICT, "同名同年份同类型条目已存在");
        }
        return view(row);
    }

    public Map<String, Object> update(String id, String ownerId, Map<String, Object> body) {
        Map<String, Object> old = owned(id, ownerId);
        String title = required(body, "title", 200, "标题为必填，且不超过 200 字");
        String type = enumValue(body, "type", TYPES, RowMap.str(old, "type"));
        int year = yearValue(body.get("year"));
        if (repo.businessExists(title, year, type, id)) {
            throw new BizException(ErrorCode.CONFLICT, "同名同年份同类型条目已存在");
        }
        Map<String, Object> row = new LinkedHashMap<>(old);
        baseRowInto(row, body, title, type, year,
                enumValue(body, "visibility", List.of("public", "private"), RowMap.str(old, "visibility")),
                enumValue(body, "watch_status", WATCH, RowMap.str(old, "watchStatus")),
                optionalUrl(body.get("external_url"), 1024, "外链 URL"));
        row.put("updatedAtMs", System.currentTimeMillis());
        if (repo.update(row) == 0) throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        return view(row);
    }

    public void delete(String id, String ownerId) {
        if (repo.softDelete(id, ownerId, System.currentTimeMillis()) == 0) {
            throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        }
    }

    /** PATCH status：观看状态 / 评分 / 进度 / 链接状态，均限作者。 */
    public Map<String, Object> patchStatus(String id, String ownerId, Map<String, Object> body) {
        Map<String, Object> row = new LinkedHashMap<>(owned(id, ownerId));
        if (body.containsKey("watch_status")) {
            row.put("watchStatus", enumValue(body, "watch_status", WATCH, RowMap.str(row, "watchStatus")));
        }
        if (body.containsKey("rating")) {
            row.put("rating", ratingValue(body.get("rating")));
        }
        if (body.containsKey("progress")) {
            row.put("progress", limited(body.get("progress"), 120, "观看进度"));
        }
        if (body.containsKey("link_status")) {
            row.put("linkStatus", enumValue(body, "link_status", LINK, "unchecked"));
        }
        if (body.containsKey("note")) {
            row.put("note", limited(body.get("note"), 1000, "短评"));
        }
        if ("watched".equals(row.get("watchStatus")) && row.get("watchedAtMs") == null) {
            row.put("watchedAtMs", System.currentTimeMillis());
        }
        row.put("updatedAtMs", System.currentTimeMillis());
        if (repo.update(row) == 0) throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        return view(row);
    }

    /* ---------------- 内部 ---------------- */

    private Map<String, Object> owned(String id, String ownerId) {
        Map<String, Object> row = repo.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "资源不存在"));
        if (!ownerId.equals(RowMap.str(row, "ownerId"))) {
            throw new BizException(ErrorCode.NOT_FOUND, "资源不存在");
        }
        return row;
    }

    private Map<String, Object> baseRow(Map<String, Object> body, String ownerId, String title,
                                        String type, int year, String visibility, String watchStatus,
                                        String externalUrl) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("ownerId", ownerId);
        baseRowInto(row, body, title, type, year, visibility, watchStatus, externalUrl);
        return row;
    }

    private void baseRowInto(Map<String, Object> row, Map<String, Object> body, String title,
                             String type, int year, String visibility, String watchStatus,
                             String externalUrl) {
        row.put("title", title);
        row.put("originalTitle", limited(pick(body, row, "original_title", "originalTitle"), 200, "原名"));
        row.put("type", type);
        row.put("year", year);
        row.put("region", limited(pick(body, row, "region", "region"), 64, "地区"));
        row.put("director", limited(pick(body, row, "director", "director"), 120, "导演"));
        row.put("castSummary", limited(pick(body, row, "cast_summary", "castSummary"), 500, "演员摘要"));
        row.put("rating", ratingValue(pick(body, row, "rating", "rating")));
        row.put("posterUrl", optionalUrl(pick(body, row, "poster_url", "posterUrl"), 512, "封面 URL"));
        row.put("externalUrl", externalUrl);
        row.put("linkSource", limited(pick(body, row, "link_source", "linkSource"), 120, "来源平台"));
        row.put("linkCode", limited(pick(body, row, "link_code", "linkCode"), 64, "提取码"));
        row.put("watchStatus", watchStatus);
        row.put("watchedAtMs", longOrNull(pick(body, row, "watched_at_ms", "watchedAtMs")));
        row.put("progress", limited(pick(body, row, "progress", "progress"), 120, "观看进度"));
        row.put("note", limited(pick(body, row, "note", "note"), 1000, "短评"));
        row.put("visibility", visibility);
        if (body.containsKey("tags")) {
            row.put("tags", JsonFields.encode(mapper, body.get("tags"), 10, 40, "标签"));
        } else {
            Object existing = row.get("tags");
            row.put("tags", existing == null ? "[]" : String.valueOf(existing));
        }
    }

    /** PUT 语义下未提交的字段沿用旧值，避免静默清空。 */
    private static Object pick(Map<String, Object> body, Map<String, Object> row,
                               String snake, String camel) {
        return body.containsKey(snake) ? body.get(snake) : row.get(camel);
    }

    /** 对外白名单：不含 linkFailCount / linkRecheckAfterMs / deletedAtMs 等内部字段。 */
    public Map<String, Object> view(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("ownerId", r.get("ownerId"));
        m.put("title", r.get("title"));
        m.put("originalTitle", r.get("originalTitle"));
        m.put("type", r.get("type"));
        m.put("year", r.get("year"));
        m.put("region", r.get("region"));
        m.put("director", r.get("director"));
        m.put("castSummary", r.get("castSummary"));
        m.put("rating", r.get("rating"));
        m.put("posterUrl", r.get("posterUrl"));
        m.put("externalUrl", r.get("externalUrl"));
        m.put("linkSource", r.get("linkSource"));
        m.put("linkCode", r.get("linkCode"));
        m.put("linkStatus", r.get("linkStatus"));
        m.put("linkCheckedAtMs", r.get("linkCheckedAtMs"));
        m.put("watchStatus", r.get("watchStatus"));
        m.put("watchedAtMs", r.get("watchedAtMs"));
        m.put("progress", r.get("progress"));
        m.put("note", r.get("note"));
        m.put("visibility", r.get("visibility"));
        m.put("tags", JsonFields.decode(mapper, r.get("tags")));
        m.put("createdAtMs", r.get("createdAtMs"));
        m.put("updatedAtMs", r.get("updatedAtMs"));
        return m;
    }

    private static String required(Map<String, Object> body, String key, int max, String message) {
        String s = str(body, key);
        if (s == null || s.isBlank() || s.length() > max) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, message);
        }
        return s.trim();
    }

    private static String enumValue(Map<String, Object> body, String key, List<String> allowed, String dflt) {
        String v = str(body, key);
        if (v == null || v.isBlank()) return dflt;
        if (!allowed.contains(v)) throw new BizException(ErrorCode.VALIDATION_ERROR, "非法的 " + key + " 值");
        return v;
    }

    private static String optionalUrl(Object raw, int max, String label) {
        String s = str(raw);
        if (s == null || s.isBlank()) return null;
        if (s.length() > max) throw new BizException(ErrorCode.VALIDATION_ERROR, label + "过长");
        if (!s.matches("(?i)^https?://[^\\s]+$")) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, label + "必须是 http/https 纯文本链接");
        }
        return s;
    }

    private static int yearValue(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) return 0;
        try {
            int y = Integer.parseInt(String.valueOf(raw).trim());
            if (y < 0 || y > 2100) throw new NumberFormatException();
            return y;
        } catch (NumberFormatException ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "年份必须是 0~2100 的整数");
        }
    }

    private static Integer ratingValue(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) return null;
        try {
            int v = Integer.parseInt(String.valueOf(raw).trim());
            if (v < 0 || v > 10) throw new NumberFormatException();
            return v;
        } catch (NumberFormatException ex) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "评分必须是 0~10 的整数");
        }
    }

    private static String limited(Object raw, int max, String label) {
        String s = str(raw);
        if (s == null) return null;
        if (s.length() > max) throw new BizException(ErrorCode.VALIDATION_ERROR, label + "不超过 " + max + " 字");
        return s;
    }

    private static Long longOrNull(Object raw) {
        if (raw == null || String.valueOf(raw).isBlank()) return null;
        try {
            return Long.parseLong(String.valueOf(raw).trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static Integer intOrNull(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            int v = Integer.parseInt(raw.trim());
            return (v >= 0 && v <= 2100) ? v : null;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static String str(Object raw) {
        return raw == null ? null : String.valueOf(raw);
    }
}
