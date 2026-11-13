package com.example.blog.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.repository.ReactionRepository;

/** F8 点赞 / 收藏：登录用户一人一次、可取消；计数聚合。 */
@Service
public class ReactionService {

    private final ReactionRepository reactions;
    private final ContentTargetService targets;

    public ReactionService(ReactionRepository reactions, ContentTargetService targets) {
        this.reactions = reactions;
        this.targets = targets;
    }

    public Map<String, Object> toggle(String targetType, String targetId, String userId, String type) {
        if (!List.of("like", "favorite").contains(type)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "非法的互动类型");
        }
        targets.requireInteractable(targetType, targetId, userId);
        boolean active = reactions.toggle(targetType, targetId, userId, type);
        return state(targetType, targetId, userId, type, active);
    }

    /** POST /api/reactions: 确保处于激活态（已取消则新增）。 */
    public Map<String, Object> add(String targetType, String targetId, String userId, String type) {
        if (!List.of("like", "favorite").contains(type)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "非法的互动类型");
        }
        targets.requireInteractable(targetType, targetId, userId);
        if (!reactions.exists(targetType, targetId, userId, type)) {
            reactions.toggle(targetType, targetId, userId, type);
        }
        return state(targetType, targetId, userId, type, true);
    }

    /** DELETE /api/reactions: 确保处于取消态（已激活则删除）。 */
    public Map<String, Object> remove(String targetType, String targetId, String userId, String type) {
        if (!List.of("like", "favorite").contains(type)) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "非法的互动类型");
        }
        targets.requireInteractable(targetType, targetId, userId);
        if (reactions.exists(targetType, targetId, userId, type)) {
            reactions.toggle(targetType, targetId, userId, type);
        }
        return state(targetType, targetId, userId, type, false);
    }

    public Map<String, Object> getState(String targetType, String targetId, String userId) {
        targets.requireInteractable(targetType, targetId, userId);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("targetType", targetType);
        m.put("targetId", targetId);
        m.put("likeCount", reactions.countByTargetAndType(targetType, targetId, "like"));
        m.put("favoriteCount", reactions.countByTargetAndType(targetType, targetId, "favorite"));
        m.put("liked", userId != null && reactions.exists(targetType, targetId, userId, "like"));
        m.put("favorited", userId != null && reactions.exists(targetType, targetId, userId, "favorite"));
        return m;
    }

    private Map<String, Object> state(String targetType, String targetId, String userId, String type, boolean active) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("targetType", targetType);
        m.put("targetId", targetId);
        m.put("type", type);
        m.put("active", active);
        m.put("likeCount", reactions.countByTargetAndType(targetType, targetId, "like"));
        m.put("favoriteCount", reactions.countByTargetAndType(targetType, targetId, "favorite"));
        m.put("liked", reactions.exists(targetType, targetId, userId, "like"));
        m.put("favorited", reactions.exists(targetType, targetId, userId, "favorite"));
        return m;
    }
}
