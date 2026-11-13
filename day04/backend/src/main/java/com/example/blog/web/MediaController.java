package com.example.blog.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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
import com.example.blog.service.MediaService;

/** F3 影视资源端点（§4.2）。列表/详情公开只读；写操作限作者。零托管文件。 */
@RestController
@RequestMapping("/api")
public class MediaController {

    private final MediaService media;
    private final UserPreferenceRepository prefs;

    public MediaController(MediaService media, UserPreferenceRepository prefs) {
        this.media = media;
        this.prefs = prefs;
    }

    @GetMapping("/media")
    public Map<String, Object> list(
            @RequestParam(value = "mine", required = false) String mine,
            @RequestParam(value = "type", required = false) String type,
            @RequestParam(value = "year", required = false) String year,
            @RequestParam(value = "watch_status", required = false) String watchStatus,
            @RequestParam(value = "link_status", required = false) String linkStatus,
            @RequestParam(value = "rating", required = false) String rating,
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "page", required = false) String page,
            @RequestParam(value = "size", required = false) String size,
            @RequestParam(value = "sort", required = false) String sort) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("mine", mine);
        params.put("type", type);
        params.put("year", year);
        params.put("watch_status", watchStatus);
        params.put("link_status", linkStatus);
        params.put("rating", rating);
        params.put("q", q);
        PageQuery pq = PageSupport.parse(page, size, sort, AuthContext.userIdOrNull(), prefs);
        return ApiResponse.success(media.list(params, pq, AuthContext.userIdOrNull()));
    }

    @PostMapping("/media")
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(media.create(body, uid));
    }

    @GetMapping("/media/{id}")
    public Map<String, Object> get(@PathVariable("id") String id) {
        return ApiResponse.success(media.get(id, AuthContext.userIdOrNull()));
    }

    @PutMapping("/media/{id}")
    public Map<String, Object> update(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(media.update(id, uid, body));
    }

    @DeleteMapping("/media/{id}")
    public Map<String, Object> delete(@PathVariable("id") String id) {
        String uid = AuthContext.requireLogin();
        media.delete(id, uid);
        return ApiResponse.success("已删除");
    }

    @PatchMapping("/media/{id}/status")
    public Map<String, Object> patchStatus(@PathVariable("id") String id, @RequestBody Map<String, Object> body) {
        String uid = AuthContext.requireLogin();
        return ApiResponse.success(media.patchStatus(id, uid, body));
    }
}
