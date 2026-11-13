package com.example.blog.web;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.PageSupport;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.repository.UserPreferenceRepository;
import com.example.blog.service.CollectionService;

/** F4 两级收藏端点（§4.2）。写操作限作者；公开只读分享页匿名可访问。 */
@RestController
@RequestMapping("/api")
public class CollectionController {

    private final CollectionService collections;
    private final UserPreferenceRepository prefs;

    public CollectionController(CollectionService collections, UserPreferenceRepository prefs) {
        this.collections = collections;
        this.prefs = prefs;
    }

    @GetMapping("/collections")
    public Map<String, Object> list(
            @RequestParam(value = "mine", required = false) String mine,
            @RequestParam(value = "page", required = false) String page,
            @RequestParam(value = "size", required = false) String size,
            @RequestParam(value = "sort", required = false) String sort) {
        boolean m = "1".equals(mine) || "true".equalsIgnoreCase(mine);
        PageQuery pq = PageSupport.parse(page, size, sort, AuthContext.userIdOrNull(), prefs);
        return ApiResponse.success(collections.list(m, AuthContext.userIdOrNull(), pq));
    }

    @PostMapping("/collections")
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(collections.create(body, uid));
    }

    @GetMapping("/collections/{id}")
    public Map<String, Object> get(@PathVariable("id") String id) {
        return ApiResponse.success(collections.get(id, AuthContext.userIdOrNull()));
    }

    @PutMapping("/collections/{id}")
    public Map<String, Object> update(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(collections.update(id, uid, body));
    }

    @DeleteMapping("/collections/{id}")
    public Map<String, Object> delete(@PathVariable("id") String id) {
        String uid = AuthContext.requireLogin();
        collections.delete(id, uid);
        return ApiResponse.success("已删除");
    }

    @GetMapping("/collections/{id}/items")
    public Map<String, Object> listItems(
            @PathVariable("id") String id,
            @RequestParam(value = "tag", required = false) String tag,
            @RequestParam(value = "page", required = false) String page,
            @RequestParam(value = "size", required = false) String size,
            @RequestParam(value = "sort", required = false) String sort) {
        PageQuery pq = PageSupport.parse(page, size, sort, AuthContext.userIdOrNull(), prefs);
        return ApiResponse.success(collections.listItems(id, AuthContext.userIdOrNull(), tag, pq));
    }

    @PostMapping("/collections/{id}/items")
    public Map<String, Object> createItem(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(collections.createItem(id, uid, body));
    }

    @PutMapping("/collections/{id}/items/{itemId}")
    public Map<String, Object> updateItem(@PathVariable("id") String id, @PathVariable("itemId") String itemId,
                                          @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(collections.updateItem(itemId, uid, body));
    }

    @DeleteMapping("/collections/{id}/items/{itemId}")
    public Map<String, Object> deleteItem(@PathVariable("id") String id, @PathVariable("itemId") String itemId) {
        String uid = AuthContext.requireLogin();
        collections.deleteItem(itemId, uid);
        return ApiResponse.success("已删除");
    }

    @PostMapping("/collections/{id}/items/order")
    public Map<String, Object> setOrder(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        collections.setItemsOrder(id, uid, toIds(body.get("ids")));
        return ApiResponse.success("顺序已保存");
    }

    @PostMapping("/collections/{id}/items/move")
    public Map<String, Object> move(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        collections.moveItems(id, str(body, "toCollectionId"), uid, toIds(body.get("ids")));
        return ApiResponse.success("已移动");
    }

    /** 匿名公开只读视图（分享页）。 */
    @GetMapping("/collections/{id}/public")
    public Map<String, Object> getPublic(
            @PathVariable("id") String id,
            @RequestParam(value = "password", required = false) String password) {
        return ApiResponse.success(collections.getPublic(id, password));
    }

    @SuppressWarnings("unchecked")
    private static List<String> toIds(Object raw) {
        if (raw instanceof List<?> list) {
            List<String> out = new java.util.ArrayList<>();
            for (Object o : list) out.add(String.valueOf(o));
            return out;
        }
        return new java.util.ArrayList<>();
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
