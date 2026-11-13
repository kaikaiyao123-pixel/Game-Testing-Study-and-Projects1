package com.example.blog.foundation.security;

import java.time.Duration;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;

/**
 * P2 基于 Redis 的固定窗口计数器限流（§5.6 / F0-7 反灌水）。
 *
 * 用于注册、评论、点赞、分享等写操作的「用户 + IP」双重限流。
 * 固定窗口实现简单、无时钟漂移；窗口起点以首次计数时刻对齐。
 *
 * Redis 不可用时的策略：fail-open（放行），保证可用性优先；限流是纵深防御的
 * 一层，不替代参数校验与审核队列。
 */
@Component
public class RateLimiter {

    private final StringRedisTemplate redis;

    public RateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * @return true 表示放行（未超过上限），false 表示被限流。
     */
    public boolean tryAcquire(String key, int max, Duration window) {
        if (key == null || key.isEmpty()) return true;
        String redisKey = "ratelimit:" + key;
        try {
            Long count = redis.opsForValue().increment(redisKey);
            if (count != null && count == 1L) {
                redis.expire(redisKey, window);
            }
            return count == null || count <= max;
        } catch (Exception ex) {
            // Redis 异常：fail-open，避免限流组件自身导致服务不可用
            return true;
        }
    }

    /** 超限时直接抛 429，供 Controller/Service 便捷调用。 */
    public void requireAllowed(String key, int max, Duration window, String message) {
        if (!tryAcquire(key, max, window)) {
            throw new BizException(ErrorCode.RATE_LIMITED, message);
        }
    }
}
