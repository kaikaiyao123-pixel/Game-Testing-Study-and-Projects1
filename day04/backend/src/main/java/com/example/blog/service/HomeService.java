package com.example.blog.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.example.blog.foundation.common.RowMap;
import com.example.blog.repository.CollectionRepository;
import com.example.blog.repository.MediaRepository;
import com.example.blog.repository.MomentRepository;

/**
 * F1 主页聚合：统计卡 + 跨模块最近动态。
 * P2 只归并 article 且 media/vault/moment 硬编码 0；P3/W0 起四项计数与最近动态
 * 全部改为真实库内查询，跨模块按 created_at_ms 归并后取最新 N 条。
 */
@Service
public class HomeService {

    private final ArticleService articles;
    private final MediaRepository media;
    private final CollectionRepository collections;
    private final MomentRepository moments;

    public HomeService(ArticleService articles, MediaRepository media,
                       CollectionRepository collections, MomentRepository moments) {
        this.articles = articles;
        this.media = media;
        this.collections = collections;
        this.moments = moments;
    }

    public Map<String, Object> summary(int limit) {
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("article", articles.countPublic());
        counts.put("media", media.countPublic());
        // 宝库统计的是「条目」而非集合，与前端「宝库条目」标签一致
        counts.put("vault", collections.countPublicItems());
        counts.put("moment", moments.countPublic());

        List<Map<String, Object>> recent = new ArrayList<>();
        for (Map<String, Object> a : articles.recent(limit)) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("type", "article");
            e.put("id", a.get("id"));
            e.put("title", a.get("title"));
            e.put("createdAtMs", a.get("publishedAtMs") == null ? a.get("createdAtMs") : a.get("publishedAtMs"));
            e.put("authorName", a.get("authorName"));
            recent.add(e);
        }
        append(recent, "media", media.recentPublic(limit));
        // 集合只统计公开集合，条目数由 countPublicItems 单独反映
        append(recent, "collection", collections.recentPublic(limit));
        append(recent, "moment", moments.recentPublic(limit));

        recent.sort(Comparator.comparingLong((Map<String, Object> e) -> number(e.get("createdAtMs"))).reversed());
        if (recent.size() > limit) recent = new ArrayList<>(recent.subList(0, limit));

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("counts", counts);
        m.put("recent", recent);
        return m;
    }

    private static void append(List<Map<String, Object>> out, String type, List<Map<String, Object>> rows) {
        for (Map<String, Object> row : rows) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("type", type);
            e.put("id", row.get("id"));
            e.put("title", titleOf(type, row));
            e.put("createdAtMs", row.get("createdAtMs"));
            e.put("authorName", null);
            out.add(e);
        }
    }

    private static String titleOf(String type, Map<String, Object> row) {
        if ("moment".equals(type)) {
            String content = RowMap.str(row, "content");
            return content == null ? "碎碎念" : (content.length() > 40 ? content.substring(0, 40) + "…" : content);
        }
        String title = RowMap.str(row, "title");
        if (title == null || title.isBlank()) title = RowMap.str(row, "name");
        return title == null ? "无题" : title;
    }

    private static long number(Object v) {
        return v instanceof Number n ? n.longValue() : 0L;
    }
}
