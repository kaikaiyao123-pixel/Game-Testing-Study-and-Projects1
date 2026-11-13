package com.example.blog.service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.example.blog.domain.UserProfile;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.repository.UserRepository;

/** F6 个人资料：本人读写、公开只读（手机号脱敏）、头像与简介更新。 */
@Service
public class ProfileService {

    private static final Pattern NICKNAME = Pattern.compile("^[\\p{L}\\p{N} _.\\-]{1,24}$");

    private final UserRepository users;
    private final ArticleService articles;

    public ProfileService(UserRepository users, ArticleService articles) {
        this.users = users;
        this.articles = articles;
    }

    public Map<String, Object> getSelf(String userId) {
        UserProfile u = require(userId);
        return selfMap(u);
    }

    public Map<String, Object> getPublic(String userId) {
        UserProfile u = require(userId);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.id());
        m.put("nickname", u.nickname());
        m.put("avatarUrl", u.avatarUrl());
        m.put("bio", u.bio());
        m.put("createdAtMs", u.createdAtMs());
        m.put("articleCount", articles.countPublicByAuthor(userId));
        return m;
    }

    public Map<String, Object> update(String userId, Map<String, Object> input) {
        UserProfile u = require(userId);
        String nickname = str(input, "nickname", u.nickname());
        String bio = input.containsKey("bio") ? str(input, "bio") : u.bio();
        if (nickname == null || !NICKNAME.matcher(nickname).matches()) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "昵称 1~24 位，仅含字母、数字、空格、_ . -");
        }
        if (bio != null && bio.length() > 500) {
            throw new BizException(ErrorCode.VALIDATION_ERROR, "简介不超过 500 字");
        }
        users.updateProfile(userId, nickname, bio == null ? "" : bio, System.currentTimeMillis());
        return getSelf(userId);
    }

    public void setAvatar(String userId, String avatarUrl) {
        require(userId);
        users.setAvatar(userId, avatarUrl, System.currentTimeMillis());
    }

    private UserProfile require(String userId) {
        Optional<UserProfile> u = users.findProfileById(userId);
        if (u.isEmpty() || (u.get().disabledAtMs() != null)) {
            throw new BizException(ErrorCode.NOT_FOUND, "用户不存在");
        }
        return u.get();
    }

    private Map<String, Object> selfMap(UserProfile u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.id());
        m.put("nickname", u.nickname());
        m.put("avatarUrl", u.avatarUrl());
        m.put("bio", u.bio());
        m.put("phoneMasked", maskPhone(u.phone()));
        m.put("createdAtMs", u.createdAtMs());
        m.put("updatedAtMs", u.updatedAtMs());
        return m;
    }

    private static String maskPhone(String phone) {
        if (phone == null || phone.length() < 7) return phone;
        return phone.substring(0, 3) + "****" + phone.substring(phone.length() - 2);
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static String str(Map<String, Object> m, String key, String dflt) {
        String v = str(m, key);
        return v == null ? dflt : v;
    }
}
