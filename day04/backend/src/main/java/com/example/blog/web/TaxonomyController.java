package com.example.blog.web;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.blog.domain.Category;
import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.repository.CategoryRepository;
import com.example.blog.repository.TagRepository;

/** F2 分类（作者私有，需登录）与标签（站点共享，公开只读）。 */
@RestController
@RequestMapping("/api")
public class TaxonomyController {

    private final CategoryRepository categories;
    private final TagRepository tags;

    public TaxonomyController(CategoryRepository categories, TagRepository tags) {
        this.categories = categories;
        this.tags = tags;
    }

    @GetMapping("/categories")
    public Map<String, Object> listCategories() {
        String uid = AuthContext.requireLogin();
        List<Category> rows = categories.listByOwner(uid);
        return ApiResponse.success(rows);
    }

    @PostMapping("/categories")
    public Map<String, Object> createCategory(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        String name = str(body, "name");
        if (name == null || name.isBlank() || name.length() > 60) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "分类名称 1~60 字");
        }
        String slug = slugify(name);
        if (slug.isEmpty()) slug = "cat-" + java.util.UUID.randomUUID().toString().substring(0, 8);
        if (categories.existsBySlugAndOwner(slug, uid)) {
            throw new BizException(ErrorCode.CONFLICT, "分类名已存在");
        }
        int order = body.containsKey("sortOrder") ? toInt(body.get("sortOrder"), 0) : 0;
        Category c = new Category(categories.nextId(), uid, name, slug, order,
                System.currentTimeMillis(), null);
        categories.insert(c);
        return ApiResponse.success(c);
    }

    @GetMapping("/tags")
    public Map<String, Object> listTags() {
        return ApiResponse.success(tags.listAll());
    }

    private static String slugify(String text) {
        if (text == null) return "";
        String s = text.toLowerCase().trim().replaceAll("\\s+", "-")
                .replaceAll("[^a-z0-9\\u4e00-\\u9fa5\\-]", "")
                .replaceAll("-+", "-").replaceAll("^-|-$", "");
        return s.length() > 80 ? s.substring(0, 80) : s;
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static int toInt(Object v, int dflt) {
        if (v == null) return dflt;
        try {
            return Integer.parseInt(String.valueOf(v));
        } catch (NumberFormatException ex) {
            return dflt;
        }
    }
}
