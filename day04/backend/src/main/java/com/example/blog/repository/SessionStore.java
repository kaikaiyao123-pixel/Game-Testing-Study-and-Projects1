package com.example.blog.repository;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import com.example.blog.domain.Session;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Redis 有状态会话仓储（对应阶段一的 data/sessions.json）。
 *
 * <p>F0 会话语义（P3/W4）：
 * <ul>
 *   <li>remember=true → TTL 30 天，滑动续期但绝对上限 30 天（自创建起算）；</li>
 *   <li>remember=false → TTL 12 小时，不续期；</li>
 *   <li>反向索引 blog:user-sessions:&lt;userId&gt;（JSON 数组）支撑「会话列表 / 踢下线 / 全部登出」；</li>
 *   <li>登出即 DEL 键并从索引移除，令牌立即失效；过期由 Redis 自动淘汰。</li>
 * </ul>
 *
 * <p>Redis 替身仅支持 GET/SET/DEL/EXPIRE/TTL 等字符串命令，不支持集合与 Lua，
 * 故反向索引以「单键 JSON 数组」实现，所有写都基于参数化/值替换，无注入面。
 */
@Repository
public class SessionStore {

    /** 记住我：30 天绝对上限（滑动续期不超过此值）。 */
    private static final long REMEMBER_TTL_MS = Duration.ofDays(30).toMillis();
    /** 普通会话：12 小时，不续期。 */
    private static final long SESSION_TTL_MS = Duration.ofHours(12).toMillis();

    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final String prefix;

    public SessionStore(
            StringRedisTemplate redis,
            ObjectMapper mapper,
            @Value("${blog.session.key-prefix:blog:session:}") String prefix,
            @Value("${blog.session.ttl-seconds:604800}") long ttlSeconds) {
        this.redis = redis;
        this.mapper = mapper;
        this.prefix = prefix;
        // ttlSeconds 仅作兼容性保留，实际 TTL 由 remember 决定。
        if (ttlSeconds <= 0) {
            // 保留字段被显式关闭时不抛错，仅不影响后续计算。
        }
    }

    public Session save(String userId, String userAgent, String ip, boolean remember) {
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);

        Instant now = Instant.now();
        long ttlMs = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
        Instant expiresAt = now.plusMillis(ttlMs);
        String agent = userAgent == null ? "" : userAgent;
        String clientIp = ip == null ? "" : ip;

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("token", token);
        payload.put("userId", userId);
        payload.put("createdAt", now.toString());
        payload.put("createdAtMs", now.toEpochMilli());
        payload.put("expiresAt", expiresAt.toString());
        payload.put("userAgent", agent);
        payload.put("ip", clientIp);
        payload.put("remember", remember);

        try {
            redis.opsForValue().set(prefix + token, mapper.writeValueAsString(payload), Duration.ofMillis(ttlMs));
        } catch (Exception ex) {
            throw new IllegalStateException("会话写入 Redis 失败", ex);
        }
        addToIndex(userId, token);
        return new Session(token, userId, now, expiresAt, agent, clientIp, remember);
    }

    public Optional<Session> find(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        String raw;
        try {
            raw = redis.opsForValue().get(prefix + token);
        } catch (Exception ex) {
            return Optional.empty();
        }
        if (raw == null) return Optional.empty();
        try {
            JsonNode node = mapper.readTree(raw);
            if (node.path("expiresAt").asText("").isEmpty()) return Optional.empty();
            Instant expires = Instant.parse(node.get("expiresAt").asText());
            if (expires.isBefore(Instant.now())) return Optional.empty();
            return Optional.of(new Session(
                    token,
                    node.get("userId").asText(),
                    Instant.parse(node.get("createdAt").asText()),
                    expires,
                    node.path("userAgent").asText(""),
                    node.path("ip").asText(""),
                    node.path("remember").asBoolean(false)));
        } catch (Exception ex) {
            return Optional.empty();
        }
    }

    public void delete(String token) {
        if (token == null || token.isBlank()) return;
        Optional<Session> s = find(token);
        s.ifPresent(v -> removeFromIndex(v.userId(), token));
        redis.delete(prefix + token);
    }

    public boolean exists(String token) {
        if (token == null || token.isBlank()) return false;
        return Boolean.TRUE.equals(redis.hasKey(prefix + token));
    }

    /** 仅用于本地健康检查统计；生产环境大键空间应改用 SCAN。 */
    public long countActive() {
        Set<String> keys = redis.keys(prefix + "*");
        return keys == null ? 0L : keys.size();
    }

    public String keyOf(String token) {
        return prefix + token;
    }

    /** 当前用户的所有有效会话（含当前）。用于「登录设备」列表。 */
    public List<Session> listByUser(String userId) {
        List<String> tokens = readIndex(userId);
        List<Session> out = new ArrayList<>();
        for (String token : tokens) {
            find(token).ifPresent(out::add);
        }
        out.sort((a, b) -> b.createdAt().compareTo(a.createdAt()));
        return out;
    }

    /** 注销除 currentToken 外的全部会话（改密后调用）。 */
    public void deleteOthers(String userId, String currentToken) {
        List<String> tokens = readIndex(userId);
        List<String> kept = new ArrayList<>();
        for (String token : tokens) {
            if (token.equals(currentToken)) {
                kept.add(token);
                continue;
            }
            redis.delete(prefix + token);
        }
        writeIndex(userId, kept);
    }

    /** 注销该用户全部会话（危险操作的「清理会话」/ 注销账号）。 */
    public void deleteAll(String userId) {
        for (String token : readIndex(userId)) {
            redis.delete(prefix + token);
        }
        redis.delete(indexKey(userId));
    }

    /**
     * 滑动续期：仅记住我会话且仍在 30 天绝对窗口内时，把 TTL 重新对齐到
     * 「创建时刻 + 30 天」，从而既滑动又封顶。非记住我会话不续期。
     */
    public void slideIfNeeded(Session session) {
        if (session == null || !session.remember()) return;
        long elapsed = System.currentTimeMillis() - session.createdAt().toEpochMilli();
        if (elapsed < 0 || elapsed >= REMEMBER_TTL_MS) return;
        long remaining = REMEMBER_TTL_MS - elapsed;
        try {
            redis.expire(prefix + session.token(), Duration.ofMillis(remaining));
        } catch (Exception ex) {
            // 续期失败不阻断主流程
        }
    }

    /* ---------------- 反向索引（单键 JSON 数组） ---------------- */

    private String indexKey(String userId) {
        return prefix + "user-sessions:" + userId;
    }

    private List<String> readIndex(String userId) {
        String raw = redis.opsForValue().get(indexKey(userId));
        if (raw == null || raw.isBlank()) return new ArrayList<>();
        try {
            List<String> out = new ArrayList<>();
            for (JsonNode n : mapper.readTree(raw)) {
                if (n.isTextual()) out.add(n.asText());
            }
            return out;
        } catch (Exception ex) {
            return new ArrayList<>();
        }
    }

    private void writeIndex(String userId, List<String> tokens) {
        try {
            redis.opsForValue().set(indexKey(userId), mapper.writeValueAsString(tokens));
        } catch (Exception ex) {
            // 索引写入失败不阻断主流程；最坏情况列表稍后返回空，登出仍可 DEL 单键。
        }
    }

    private void addToIndex(String userId, String token) {
        List<String> tokens = readIndex(userId);
        if (!tokens.contains(token)) tokens.add(token);
        writeIndex(userId, tokens);
    }

    private void removeFromIndex(String userId, String token) {
        List<String> tokens = readIndex(userId);
        if (tokens.remove(token)) writeIndex(userId, tokens);
    }
}
