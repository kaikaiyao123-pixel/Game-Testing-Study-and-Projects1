package com.example.blog.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.JsonFields;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.RowMap;
import com.example.blog.foundation.security.ReadGuard;
import com.example.blog.repository.CollectionItemRepository;
import com.example.blog.repository.CollectionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * F4 两级收藏：集合（默认私有）+ 条目（外链索引，零托管文件）。
 *
 * <p>所有写操作先校验集合归属（owner），越权与不存在统一 404；公开只读分享页仅对
 * public 集合开放，可选访问口令。
 */
@Service
public class CollectionService {

    private static final List<String> TYPES = List.of("url", "text");

    private final CollectionRepository collections;
    private final CollectionItemRepository items;
    private final ObjectMapper mapper;

    public CollectionService(CollectionRepository collections, CollectionItemRepository items,
                             ObjectMapper mapper) {
        this.collections = collections;
        this.items = items;
        this.mapper = mapper;
    }

    public Map<String, Object> list(boolean mine, String viewerId, PageQuery q) {
        List<Map<String, Object>> rows = collections.list(mine && viewerId != null, viewerId, q);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) out.add(viewCollection(r, viewerId));
        return page(out, collections.count(mine && viewerId != null, viewerId), q);
    }

    public Map<String, Object> get(String id, String viewerId) {
        Map<String, Object> row = collections.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "收藏集不存在"));
        ReadGuard.require(RowMap.str(row, "visibility"), RowMap.str(row, "ownerId"), viewerId);
        return detail(row, viewerId);
    }

    /** 匿名公开只读视图（分享页用）；private 集合或非匹配口令一律 404/403。 */
    public Map<String, Object> getPublic(String id, String password) {
        Map<String, Object> row = collections.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "收藏集不存在"));
        if (!"public".equals(RowMap.str(row, "visibility"))) {
            throw new BizException(ErrorCode.NOT_FOUND, "收藏集不存在");
        }
        String pw = RowMap.str(row, "sharePassword");
        if (pw != null && !pw.isBlank() && !pw.equals(password)) {
            throw new BizException(ErrorCode.FORBIDDEN, "访问口令不正确");
        }
        Map<String, Object> m = detail(row, null);
        m.remove("sharePassword");
        return m;
    }

    public Map<String, Object> create(Map<String, Object> body, String ownerId) {
        String name = required(body, "name", 60, "收藏集名称必填且不超过 60 字");
        String description = limited(body.get("description"), 500, "简介");
        String coverUrl = optionalUrl(body.get("cover_url"), 512, "封面 URL");
        String visibility = enumValue(body, "visibility", List.of("public", "private"), "private");
        String sharePassword = visibility.equals("public")
                ? limited(body.get("share_password"), 64, "访问口令") : null;

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", UUID.randomUUID().toString());
        row.put("ownerId", ownerId);
        row.put("name", name);
        row.put("description", description);
        row.put("coverUrl", coverUrl);
        row.put("visibility", visibility);
        row.put("sharePassword", sharePassword);
        row.put("sortOrder", 0);
        long now = System.currentTimeMillis();
        row.put("createdAtMs", now);
        row.put("updatedAtMs", now);
        row.put("deletedAtMs", null);
        collections.insert(row);
        return viewCollection(row, ownerId);
    }

    public Map<String, Object> update(String id, String ownerId, Map<String, Object> body) {
        Map<String, Object> old = owned(id, ownerId);
        if (body.containsKey("name")) {
            old.put("name", required(body, "name", 60, "收藏集名称必填且不超过 60 字"));
        }
        if (body.containsKey("description")) {
            old.put("description", limited(body.get("description"), 500, "简介"));
        }
        if (body.containsKey("cover_url")) {
            old.put("coverUrl", optionalUrl(body.get("cover_url"), 512, "封面 URL"));
        }
        if (body.containsKey("visibility")) {
            old.put("visibility", enumValue(body, "visibility", List.of("public", "private"),
                    RowMap.str(old, "visibility")));
        }
        if (body.containsKey("share_password")) {
            old.put("sharePassword", optionalPassword(body.get("share_password")));
        }
        old.put("updatedAtMs", System.currentTimeMillis());
        if (collections.update(old) == 0) throw new BizException(ErrorCode.NOT_FOUND, "收藏集不存在");
        return viewCollection(old, ownerId);
    }

    public void delete(String id, String ownerId) {
        if (collections.softDelete(id, ownerId, System.currentTimeMillis()) == 0) {
            throw new BizException(ErrorCode.NOT_FOUND, "收藏集不存在");
        }
    }

    /* ---------------- 条目 ---------------- */

    public Map<String, Object> listItems(String collectionId, String viewerId, String tag, PageQuery q) {
        ownedViewable(collectionId, viewerId);
        List<Map<String, Object>> rows = items.list(collectionId, tag, q);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) out.add(viewItem(r));
        return page(out, items.count(collectionId, tag), q);
    }

    public Map<String, Object> createItem(String collectionId, String ownerId, Map<String, Object> body) {
        owned(collectionId, ownerId);
        String title = required(body, "title", 200, "标题必填且不超过 200 字");
        String type = enumValue(body, "type", TYPES, "url");
        String url = "url".equals(type) ? optionalUrl(body.get("url"), 2048, "链接") : null;
        String thumbnailUrl = optionalUrl(body.get("thumbnail_url"), 512, "缩略图 URL");
        String note = limited(body.get("note"), 1000, "备注");

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", UUID.randomUUID().toString());
        row.put("collectionId", collectionId);
        row.put("type", type);
        row.put("title", title);
        row.put("url", url);
        row.put("thumbnailUrl", thumbnailUrl);
        row.put("note", note);
        row.put("tags", JsonFields.encode(mapper, body.get("tags"), 20, 40, "标签"));
        row.put("sortOrder", items.nextSortOrder(collectionId));
        row.put("linkStatus", "unchecked");
        row.put("linkCheckedAtMs", null);
        row.put("linkRecheckAfterMs", 0L);
        row.put("linkFailCount", 0);
        row.put("createdAtMs", System.currentTimeMillis());
        row.put("deletedAtMs", null);
        items.insert(row);
        return viewItem(row);
    }

    public Map<String, Object> updateItem(String itemId, String ownerId, Map<String, Object> body) {
        Map<String, Object> old = ownedItem(itemId, ownerId);
        if (body.containsKey("title")) {
            old.put("title", required(body, "title", 200, "标题必填且不超过 200 字"));
        }
        if (body.containsKey("type")) {
            old.put("type", enumValue(body, "type", TYPES, RowMap.str(old, "type")));
        }
        if (body.containsKey("url")) {
            old.put("url", "url".equals(old.get("type")) ? optionalUrl(body.get("url"), 2048, "链接") : null);
        }
        if (body.containsKey("thumbnail_url")) {
            old.put("thumbnailUrl", optionalUrl(body.get("thumbnail_url"), 512, "缩略图 URL"));
        }
        if (body.containsKey("note")) {
            old.put("note", limited(body.get("note"), 1000, "备注"));
        }
        if (body.containsKey("tags")) {
            old.put("tags", JsonFields.encode(mapper, body.get("tags"), 20, 40, "标签"));
        }
        if (items.updateItem(old) == 0) throw new BizException(ErrorCode.NOT_FOUND, "条目不存在");
        return viewItem(old);
    }

    public void deleteItem(String itemId, String ownerId) {
        Map<String, Object> old = ownedItem(itemId, ownerId);
        if (items.softDelete(itemId, old.get("collectionId").toString(), System.currentTimeMillis()) == 0) {
            throw new BizException(ErrorCode.NOT_FOUND, "条目不存在");
        }
    }

    /** 拖拽排序：传入该集合内有序的条目 id 数组，落库新顺序。 */
    public void setItemsOrder(String collectionId, String ownerId, List<String> ids) {
        owned(collectionId, ownerId);
        if (ids == null || ids.isEmpty()) return;
        items.applyOrder(collectionId, ids);
    }

    /** 批量移动条目到另一集合（须同 owner）。 */
    public void moveItems(String fromId, String toId, String ownerId, List<String> ids) {
        owned(fromId, ownerId);
        owned(toId, ownerId);
        if (ids == null || ids.isEmpty()) return;
        items.moveItems(fromId, toId, ids);
    }

    /* ---------------- 内部 ---------------- */

    private Map<String, Object> owned(String id, String ownerId) {
        Map<String, Object> row = collections.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "收藏集不存在"));
        if (!ownerId.equals(RowMap.str(row, "ownerId"))) {
            throw new BizException(ErrorCode.NOT_FOUND, "收藏集不存在");
        }
        return row;
    }

    private void ownedViewable(String id, String viewerId) {
        Map<String, Object> row = collections.findById(id)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "收藏集不存在"));
        ReadGuard.require(RowMap.str(row, "visibility"), RowMap.str(row, "ownerId"), viewerId);
    }

    private Map<String, Object> ownedItem(String itemId, String ownerId) {
        Map<String, Object> item = items.findById(itemId)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "条目不存在"));
        String collectionId = RowMap.str(item, "collectionId");
        Map<String, Object> col = collections.findById(collectionId)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "收藏集不存在"));
        if (!ownerId.equals(RowMap.str(col, "ownerId"))) {
            throw new BizException(ErrorCode.NOT_FOUND, "条目不存在");
        }
        item.put("collectionId", collectionId);
        return item;
    }

    private Map<String, Object> detail(Map<String, Object> row, String viewerId) {
        Map<String, Object> m = viewCollection(row, viewerId);
        PageQuery q = PageQuery.parse(null, "50", null);
        List<Map<String, Object>> itemRows = items.list(RowMap.str(row, "id"), null, q);
        List<Map<String, Object>> itemViews = new ArrayList<>();
        for (Map<String, Object> r : itemRows) itemViews.add(viewItem(r));
        m.put("items", itemViews);
        m.put("itemCount", itemViews.size());
        return m;
    }

    private Map<String, Object> viewCollection(Map<String, Object> r, String viewerId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("ownerId", r.get("ownerId"));
        m.put("name", r.get("name"));
        m.put("description", r.get("description"));
        m.put("coverUrl", r.get("coverUrl"));
        m.put("visibility", r.get("visibility"));
        m.put("sharePassword", r.get("sharePassword"));
        m.put("sortOrder", r.get("sortOrder"));
        m.put("createdAtMs", r.get("createdAtMs"));
        m.put("updatedAtMs", r.get("updatedAtMs"));
        return m;
    }

    private Map<String, Object> viewItem(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.get("id"));
        m.put("collectionId", r.get("collectionId"));
        m.put("type", r.get("type"));
        m.put("title", r.get("title"));
        m.put("url", r.get("url"));
        m.put("thumbnailUrl", r.get("thumbnailUrl"));
        m.put("note", r.get("note"));
        m.put("tags", JsonFields.decode(mapper, r.get("tags")));
        m.put("sortOrder", r.get("sortOrder"));
        m.put("linkStatus", r.get("linkStatus"));
        m.put("createdAtMs", r.get("createdAtMs"));
        return m;
    }

    private static Map<String, Object> page(List<Map<String, Object>> items, long total, PageQuery q) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("items", items);
        m.put("total", total);
        m.put("page", q.page());
        m.put("size", q.size());
        return m;
    }

    private static String required(Map<String, Object> body, String key, int max, String message) {
        Object v = body.get(key);
        String s = v == null ? null : String.valueOf(v).trim();
        if (s == null || s.isEmpty() || s.length() > max) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, message);
        }
        return s;
    }

    private static String limited(Object raw, int max, String label) {
        String s = raw == null ? null : String.valueOf(raw).trim();
        if (s == null || s.isEmpty()) return null;
        if (s.length() > max) throw new BizException(ErrorCode.VALIDATION_ERROR, label + "不超过 " + max + " 字");
        return s;
    }

    private static String enumValue(Map<String, Object> body, String key, List<String> allowed, String dflt) {
        Object v = body.get(key);
        if (v == null || String.valueOf(v).isBlank()) return dflt;
        String s = String.valueOf(v);
        if (!allowed.contains(s)) throw new BizException(ErrorCode.VALIDATION_ERROR, "非法的 " + key + " 值");
        return s;
    }

    private static String optionalUrl(Object raw, int max, String label) {
        String s = raw == null ? null : String.valueOf(raw).trim();
        if (s == null || s.isEmpty()) return null;
        if (s.length() > max) throw new BizException(ErrorCode.VALIDATION_ERROR, label + "过长");
        if (!s.matches("(?i)^https?://[^\\s]+$")) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, label + "必须是 http/https 纯文本链接");
        }
        return s;
    }

    private static String optionalPassword(Object raw) {
        String s = raw == null ? null : String.valueOf(raw).trim();
        if (s == null || s.isEmpty()) return null;
        if (s.length() > 64) throw new BizException(ErrorCode.VALIDATION_ERROR, "访问口令不超过 64 字");
        return s;
    }
}
