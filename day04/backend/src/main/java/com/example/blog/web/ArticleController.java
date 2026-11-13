package com.example.blog.web;

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
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.security.AuthContext;
import com.example.blog.service.ArticleService;

/** F2 文章 REST 端点（§4.2）。列表/详情公开，写操作必须登录。 */
@RestController
@RequestMapping("/api")
public class ArticleController {

    private final ArticleService articles;

    public ArticleController(ArticleService articles) {
        this.articles = articles;
    }

    @GetMapping("/articles")
    public Map<String, Object> list(
            @RequestParam(value = "page", required = false) String page,
            @RequestParam(value = "size", required = false) String size,
            @RequestParam(value = "sort", required = false) String sort,
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "tag", required = false) String tag,
            @RequestParam(value = "q", required = false) String q) {
        PageQuery pq = PageQuery.parse(page, size, sort);
        return ApiResponse.success(articles.listPublic(pq, category, tag, q, AuthContext.userIdOrNull()));
    }

    @PostMapping("/articles")
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(articles.create(body, uid));
    }

    @GetMapping("/articles/{id}")
    public Map<String, Object> get(@PathVariable("id") String id) {
        String viewer = AuthContext.userIdOrNull();
        try {
            return ApiResponse.success(articles.getById(id, viewer));
        } catch (BizException ex) {
            if (ex.errorCode() == ErrorCode.NOT_FOUND) {
                return ApiResponse.success(articles.getBySlug(id, viewer));
            }
            throw ex;
        }
    }

    @PutMapping("/articles/{id}")
    public Map<String, Object> update(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(articles.update(id, uid, body));
    }

    @DeleteMapping("/articles/{id}")
    public Map<String, Object> delete(@PathVariable("id") String id) {
        String uid = AuthContext.requireLogin();
        articles.delete(id, uid);
        return ApiResponse.success("已删除");
    }
}
