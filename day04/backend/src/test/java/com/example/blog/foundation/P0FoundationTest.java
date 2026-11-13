package com.example.blog.foundation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.example.blog.foundation.common.ApiResponse;
import com.example.blog.foundation.common.BizException;
import com.example.blog.foundation.common.CursorCodec;
import com.example.blog.foundation.common.CursorPage;
import com.example.blog.foundation.common.ErrorCode;
import com.example.blog.foundation.common.PageQuery;
import com.example.blog.foundation.common.PageResult;
import com.example.blog.foundation.config.MultipartConfig;
import com.example.blog.foundation.config.SiteProperties;
import com.example.blog.foundation.security.AuthContext;

/**
 * P0 地基单元测试（文档 §10 风险表：P0 起补 spring-boot-starter-test 用例，
 * 不以端到端脚本替代全部单测）。本类不加载 Spring 上下文，
 * 因此不需要 MySQL / Redis，可在纯编译环境独立运行。
 */
class P0FoundationTest {

    @AfterEach
    void clearThreadLocal() {
        AuthContext.clear();
    }

    @Test
    void pageQueryDefaultsAndClamping() {
        PageQuery q = PageQuery.parse(null, null, null);
        assertEquals(1, q.page());
        assertEquals(PageQuery.DEFAULT_SIZE, q.size());
        assertEquals("created_at_ms:desc", q.sort());
        assertEquals(0L, q.offset());

        assertEquals(PageQuery.MAX_SIZE, PageQuery.parse("1", "1000", null).size());
        assertEquals(1, PageQuery.parse("0", "0", null).page());
        assertEquals(PageQuery.DEFAULT_SIZE, PageQuery.parse("abc", "-5", null).size());
        assertEquals(30L, PageQuery.parse("2", "30", null).offset());
    }

    @Test
    void pageQueryRejectsSortOutsideWhitelist() {
        BizException ex = assertThrows(BizException.class,
                () -> PageQuery.parse("1", "20", "id; DROP TABLE user"));
        assertEquals(400, ex.getStatus());
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.errorCode());
    }

    /**
     * 回归：sort() 是「列名:方向」的声明式格式，冒号不能进 SQL。
     * 曾经直接拼 sort() 导致 MySQL 语法错误（真实 500），故固化 orderBy() 的转换结果。
     */
    @Test
    void pageQueryOrderByIsValidSqlFragment() {
        assertEquals("created_at_ms DESC", PageQuery.parse(null, null, null).orderBy());
        assertEquals("created_at_ms ASC",
                PageQuery.parse("1", "20", "created_at_ms:asc").orderBy());
        assertEquals("published_at_ms DESC",
                PageQuery.parse("1", "20", "published_at_ms:desc").orderBy());
        assertFalse(PageQuery.parse(null, null, null).orderBy().contains(":"),
                "orderBy() 不得含有冒号");
    }

    @Test
    void pageResultShape() {
        PageQuery q = PageQuery.parse("2", "10", null);
        Map<String, Object> body = PageResult.of(List.of("a", "b"), 25, q);
        assertEquals(List.of("a", "b"), body.get("items"));
        assertEquals(25L, body.get("total"));
        assertEquals(2, body.get("page"));
        assertEquals(10, body.get("size"));
        assertEquals(Boolean.TRUE, body.get("hasMore"));
    }

    @Test
    void cursorRoundTrip() {
        String id = UUID.randomUUID().toString();
        long timestamp = 1700000000123L;
        String encoded = CursorCodec.encode(timestamp, id);
        assertFalse(encoded.contains("="), "游标必须无填充");
        CursorCodec.Cursor decoded = CursorCodec.decode(encoded);
        assertEquals(timestamp, decoded.createdAtMs());
        assertEquals(id, decoded.id());
    }

    @Test
    void cursorRejectsTamperedChecksum() {
        String id = UUID.randomUUID().toString();
        String valid = CursorCodec.encode(1700000000123L, id);
        String raw = new String(Base64.getUrlDecoder().decode(valid), StandardCharsets.UTF_8);
        String tampered = "1700000000999" + raw.substring(raw.indexOf(':'));
        String encoded = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(tampered.getBytes(StandardCharsets.UTF_8));
        BizException ex = assertThrows(BizException.class, () -> CursorCodec.decode(encoded));
        assertEquals(400, ex.getStatus());
    }

    @Test
    void cursorRejectsMalformedInput() {
        assertThrows(BizException.class, () -> CursorCodec.decode("not-base64!!!"));
        assertThrows(BizException.class, () -> CursorCodec.decode(""));
        assertThrows(BizException.class,
                () -> CursorCodec.encode(0L, UUID.randomUUID().toString()));
        assertThrows(BizException.class, () -> CursorCodec.encode(1700000000123L, "not-a-uuid"));
    }

    @Test
    void cursorPageTruncatesExtraItem() {
        Map<String, Object> body = CursorPage.of(List.of("a", "b", "c"), 2, "NEXT");
        assertEquals(2, ((List<?>) body.get("items")).size());
        assertEquals(Boolean.TRUE, body.get("hasMore"));
        assertEquals("NEXT", body.get("nextCursor"));

        Map<String, Object> last = CursorPage.of(List.of("a"), 2, null);
        assertEquals(Boolean.FALSE, last.get("hasMore"));
        assertNull(last.get("nextCursor"));
    }

    @Test
    void responseShapes() {
        Map<String, Object> ok = ApiResponse.success("上传成功", List.of("a"));
        assertEquals(Boolean.TRUE, ok.get("ok"));
        assertEquals("上传成功", ok.get("message"));
        assertTrue(ok.containsKey("data"));

        Map<String, Object> bad = ApiResponse.failure(ErrorCode.UNAUTHORIZED);
        assertEquals(Boolean.FALSE, bad.get("ok"));
        assertEquals("UNAUTHORIZED", bad.get("code"));
        assertEquals("请先登录", bad.get("message"));
    }

    @Test
    void bizExceptionCarriesStatusAndCode() {
        BizException ex = new BizException(ErrorCode.NOT_FOUND);
        assertEquals(404, ex.getStatus());
        assertEquals(ErrorCode.NOT_FOUND, ex.errorCode());
        assertEquals(ErrorCode.NOT_FOUND, ErrorCode.fromHttpStatus(404));
        assertEquals(ErrorCode.INTERNAL_ERROR, ErrorCode.fromHttpStatus(418));
    }

    @Test
    void guestIsExplicitDefaultState() {
        assertTrue(AuthContext.isGuest());
        assertNull(AuthContext.userIdOrNull());
        BizException ex = assertThrows(BizException.class, AuthContext::requireLogin);
        assertEquals(401, ex.getStatus());
        assertEquals(ErrorCode.UNAUTHORIZED, ex.errorCode());
    }

    @Test
    void loggedInPrincipalAndOwnerCheck() {
        AuthContext.set(AuthContext.Principal.loggedIn("token-1", "user-1"));
        assertFalse(AuthContext.isGuest());
        assertEquals("user-1", AuthContext.requireLogin());
        assertEquals("user-1", AuthContext.requireOwner("user-1"));

        BizException ex = assertThrows(BizException.class, () -> AuthContext.requireOwner("user-2"));
        assertEquals(404, ex.getStatus(), "越权必须返回 404 以避免存在性泄露");
        assertEquals(ErrorCode.NOT_FOUND, ex.errorCode());
    }

    @Test
    void sitePropertiesHaveSafeDefaults() {
        SiteProperties properties = new SiteProperties();
        assertEquals("炫与梓", properties.getSiteName());
        assertEquals("public", properties.getDefaultVisibility());
        assertEquals(20, properties.getPageSize());
        assertTrue(properties.isCommentModeration());
    }

    @Test
    void multipartLimitMatchesDocument() {
        assertEquals(2L * 1024 * 1024, MultipartConfig.MAX_FILE_SIZE);
        assertEquals(4L * 1024 * 1024, MultipartConfig.MAX_REQUEST_SIZE);
    }
}
