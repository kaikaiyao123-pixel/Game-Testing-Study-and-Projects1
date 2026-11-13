package com.example.blog.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.CursorCodec;
import com.example.blog.foundation.common.CursorPage;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.JsonFields;
import com.example.blog.foundation.common.RowMap;
import com.example.blog.repository.MomentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * F5 碎碎念：游标时间线 + 置顶分离 + 月份归档。
 *
 * <p>游标严格基于 (created_at_ms, id) 复合比较，高频插入同一毫秒也不重不漏；
 * 置顶项单独返回，不污染游标序列；内容 ≤500 字、配图 ≤9 张（外链 URL，零托管文件）。
 */
@Service
public class MomentService {

    private static final int MAX_CONTENT = 500;
    private static final int MAX_IMAGES = 9;

    private final MomentRepository moments;
    private final ObjectMapper mapper;

    public MomentService(MomentRepository moments, ObjectMapper mapper) {
        this.moments = moments;
        this.mapper = mapper;
    }

    public Map<String, Object> timeline(String beforeCursor, int size, String viewerId) {
        CursorCodec.Cursor before = (beforeCursor == null || beforeCursor.isBlank())
                ? null : CursorCodec.decode(beforeCursor);
        List<Map<String, Object>> rows = moments.timeline(before, size, viewerId);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> r : rows) items.add(view(r));
        String nextCursor = null;
        if (items.size() > size) {
            Map<String, Object> last = items.get(size); // 多取的那一条，用于生成下一页游标
            nextCursor = CursorCodec.encode(RowMap.lng(last, "createdAtMs"), RowMap.str(last, "id"));
        }
        Map<String, Object> body = CursorPage.of(items, size, nextCursor);
        body.put("pinned", pinned(viewerId));
        return body;
    }

    public Map<String, Object> create(Map<String, Object> body, String authorId) {
        String content = content(body);
        String visibility = str(body, "visibility", "public");
        if (!"public".equals(visibility) && !"private".equals(visibility)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "可见性必须是 public 或 private");
        }
        String images = JsonFields.encode(mapper, body.get("images"), MAX_IMAGES, 2048, "配图");
        int pinned = bool(body, "pinned") ? 1 : 0;

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", UUID.randomUUID().toString());
        row.put("authorId", authorId);
        row.put("content", content);
        row.put("images", images);
        row.put("visibility", visibility);
        row.put("pinned", pinned);
        row.put("createdAtMs", System.currentTimeMillis());
        row.put("deletedAtMs", null);
        moments.insert(row);
        return view(row);
    }

    public Map<String, Object> update(String id, String authorId, Map<String, Object> body) {
        Map<String, Object> old = owned(id, authorId);
        if (body.containsKey("content")) old.put("content", content(body));
        if (body.containsKey("visibility")) {
            String v = str(body, "visibility", RowMap.str(old, "visibility"));
            if (!"public".equals(v) && !"private".equals(v)) {
                throw new BizException(ErrorCode.VALIDATION_ERROR, "可见性必须是 public 或 private");
            }
            old.put("visibility", v);
        }
        if (body.containsKey("images")) {
            old.put("images", JsonFields.encode(mapper, body.get("images"), MAX_IMAGES, 2048, "配图"));
        }
        if (body.containsKey("pinned")) old.put("pinned", bool(body, "pinned") ? 1 : 0);
        if (moments.update(id, authorId, RowMap.str(old, "content"), RowMap.str(old, "images"),
                RowMap.str(old, "visibility"), RowMap.integer(old, "pinned")) == 0) {
            throw new BizException(ErrorCode.NOT_FOUND, "碎碎念不存在");
        }
        return view(old);
    }

    public void delete(String id, String authorId) {
        if (moments.softDelete(id, authorId, System.currentTimeMillis()) == 0) {
            throw new BizException(ErrorCode.NOT_FOUND, "碎碎念不存在");
        }
    }

    /** 匿名公开读取（分享页用）；私有或非作者一律 404。 */
    public Map<String, Object> getById(String id, String viewerId) {
        Map<String, Object> row = moments.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "碎碎念不存在"));
        com.example.blog.foundation.security.ReadGuard.require(
                RowMap.str(row, "visibility"), RowMap.str(row, "authorId"), viewerId);
        return view(row);
    }

    public Map<String, Object> archive(String viewerId) {
        List<Map<String, Object>> rows = moments.archive(viewerId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("month", r.get("ym"));
            m.put("count", r.get("cnt"));
            out.add(m);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("months", out);
        return body;
    }

    /* ---------------- 内部 ---------------- */

    private Map<String, Object> owned(String id, String authorId) {
        Map<String, Object> row = moments.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "碎碎念不存在"));
        if (!authorId.equals(RowMap.str(row, "authorId"))) {
            throw new BizException(ErrorCode.NOT_FOUND, "碎碎念不存在");
        }
        return row;
    }

    private List<Map<String, Object>> pinned(String viewerId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : moments.pinnedVisible(viewerId, 20)) out.add(view(r));
        return out;
    }

    private Map<String, Object> view(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("authorId", r.get("authorId"));
        m.put("content", r.get("content"));
        m.put("images", JsonFields.decode(mapper, r.get("images")));
        m.put("visibility", r.get("visibility"));
        m.put("pinned", RowMap.integer(r, "pinned") == 1);
        m.put("createdAtMs", r.get("createdAtMs"));
        return m;
    }

    private static String content(Map<String, Object> body) {
        Object v = body.get("content");
        String s = v == null ? null : String.valueOf(v);
        if (s == null || s.isBlank()) throw new BizException(ErrorCode.VALIDATION_ERROR, "内容不能为空");
        if (s.codePointCount(0, s.length()) > MAX_CONTENT) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "内容不超过 " + MAX_CONTENT + " 字");
        }
        return s;
    }

    private static String str(Map<String, Object> body, String key, String dflt) {
        Object v = body.get(key);
        return v == null || String.valueOf(v).isBlank() ? dflt : String.valueOf(v);
    }

    private static boolean bool(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v instanceof Boolean b) return b;
        return "true".equalsIgnoreCase(String.valueOf(v));
    }
}
