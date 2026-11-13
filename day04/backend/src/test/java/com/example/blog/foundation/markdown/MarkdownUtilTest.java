package com.example.blog.foundation.markdown;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** P2 Markdown 渲染与 XSS 净化单测（§5.8）。 */
class MarkdownUtilTest {

    @Test
    void rendersBasicMarkdown() {
        String html = MarkdownUtil.toHtml("# 标题\n\n这是 **加粗** 与 *斜体*。");
        assertTrue(html.contains("<h1>标题</h1>"), html);
        assertTrue(html.contains("<strong>加粗</strong>"), html);
        assertTrue(html.contains("<em>斜体</em>"), html);
    }

    @Test
    void rendersSafeLink() {
        String html = MarkdownUtil.toHtml("访问 [示例](https://example.com) 站点。");
        assertTrue(html.contains("<a href=\"https://example.com\">示例</a>"), html);
    }

    @Test
    void stripsScriptTag() {
        String html = MarkdownUtil.toHtml("你好 <script>alert(1)</script> 世界");
        assertFalse(html.toLowerCase().contains("<script"), "原始 HTML 标签必须被转义，不能原样输出");
        assertTrue(html.contains("&lt;script&gt;"), html);
    }

    @Test
    void stripsInlineEventHandler() {
        // 含空白的“URL”整体不匹配图片语法，因此不会生成 <img>；
        // 断言必须针对「是否产出可执行标记」，而不是纯文本里是否出现 onerror 字样
        // （降级为文本时该字样本就会作为普通字符保留，这是正确行为）。
        String html = MarkdownUtil.toHtml("![x](http://e/x.png onerror=alert(1))");
        assertFalse(html.contains("<img"), "含属性注入的图片语法不得生成 <img> 标签");
        assertFalse(html.toLowerCase().contains("src="), "不得输出 src 属性");
        assertFalse(html.toLowerCase().contains("<script"), "不得输出 script 标签");
    }

    @Test
    void rejectsJavascriptUrl() {
        String html = MarkdownUtil.toHtml("点击 [这里](javascript:alert(1))");
        assertFalse(html.contains("<a "), "非法链接不应生成 <a> 标签");
        assertFalse(html.contains("href="), "不得输出 href 属性");
        assertTrue(html.contains("点击"), "链接文字应降级为普通文本");
    }

    @Test
    void stripsDangerousTagButKeepsText() {
        String html = MarkdownUtil.toHtml("一段 <iframe src=\"http://evil\"></iframe> 文本");
        assertFalse(html.toLowerCase().contains("<iframe"), html);
        assertTrue(html.contains("文本"), html);
    }

    @Test
    void codeFenceIsEscaped() {
        String html = MarkdownUtil.toHtml("```\n<b>x</b>\n```");
        assertTrue(html.contains("<pre><code>"), html);
        assertTrue(html.contains("&lt;b&gt;"), "代码块内 HTML 必须转义");
    }

    @Test
    void sanitizeRemovesDisallowedAttribute() {
        String out = HtmlSanitizer.sanitize("<a href=\"https://a.com\" style=\"color:red\">x</a>");
        assertFalse(out.contains("style"), "style 属性必须被剔除");
        assertTrue(out.contains("href=\"https://a.com\""), out);
    }

    @Test
    void sanitizeDropsUnknownTag() {
        assertEquals("", HtmlSanitizer.sanitize("<unknown>hi</unknown>"));
    }

    /**
     * 设计决策锁定：Markdown 正文一律逐字符转义，原始 HTML 以纯文本呈现。
     *
     * <p>不是「删除标签、保留内容」——后者会让 {@code <iframe>} 里的文字
     * 泄漏为正文。同时也不应因为转义而丢掉用户输入的任何文字。
     */
    @Test
    void escapesRawHtmlInsteadOfStrippingIt() {
        String html = MarkdownUtil.toHtml("前言\n\n<iframe src=\"http://evil/\">内嵌</iframe>\n\n后记");
        assertFalse(html.contains("<iframe"), "不得产出 iframe 标签: " + html);
        assertTrue(html.contains("&lt;iframe"), "原始标签应被转义: " + html);
        assertTrue(html.contains("内嵌"), "被转义的内容仍以纯文本展示: " + html);
    }
}
