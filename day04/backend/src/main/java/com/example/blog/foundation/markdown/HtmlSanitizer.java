package com.example.blog.foundation.markdown;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * P2 严格白名单 HTML 净化器（§5.8 XSS 防护）。
 *
 * 设计立场：净化是「最后一道防线」，主路径由 MarkdownUtil 仅产出受控标签。
 * 本类对一段 HTML 做保守解析——未知标签整体丢弃、已知标签只保留 href/src
 * 两种属性且必须经过 isSafeUrl 校验，其余属性（style / on* / data: 等）一律剔除。
 *
 * 不进行任何外部依赖，纯字符串状态机实现，便于离线构建与单测覆盖。
 */
public final class HtmlSanitizer {

    private static final Set<String> ALLOWED_TAGS = Set.of(
            "p", "br", "h1", "h2", "h3", "h4", "h5", "h6",
            "strong", "em", "code", "pre", "blockquote",
            "ul", "ol", "li", "a", "img", "hr");

    private static final Set<String> URL_ATTRS = Set.of("href", "src");

    private static final Pattern ATTR = Pattern.compile("([a-zA-Z_:][-a-zA-Z0-9_:.]*)\\s*=\\s*\"([^\"]*)\"");

    private HtmlSanitizer() {
    }

    /**
     * 逐字符扫描并重建 HTML。
     *
     * 关键策略：命中「不允许的标签」时，其**内部文本也一并丢弃**，直到匹配的闭合标签。
     * 只删标签而保留文本会造成内容残缺（例如 &lt;iframe&gt; 内的提示语泄漏到正文），
     * 且对嵌套同名标签需要计数，避免提前结束。
     */
    public static String sanitize(String html) {
        if (html == null) return "";
        String lower = html.toLowerCase(Locale.ROOT);
        StringBuilder out = new StringBuilder();
        int i = 0;
        int n = html.length();
        while (i < n) {
            char c = html.charAt(i);
            if (c != '<') {
                out.append(c);
                i++;
                continue;
            }
            int gt = html.indexOf('>', i);
            if (gt < 0) {
                out.append("&lt;").append(html.substring(i + 1));
                break;
            }
            String rawTag = html.substring(i, gt + 1);
            String tagName = tagName(rawTag);
            boolean closing = rawTag.startsWith("</");
            boolean allowed = tagName != null && ALLOWED_TAGS.contains(tagName);

            if (allowed) {
                out.append(sanitizeTag(rawTag));
                i = gt + 1;
                continue;
            }
            if (closing) {
                // 孤立的非法闭合标签直接丢弃
                i = gt + 1;
                continue;
            }
            // 非白名单标签：跳过整段内容（含嵌套同名标签），防止内容残缺
            i = skipElement(lower, i, gt, tagName);
        }
        return out.toString();
    }

    /** 返回起始标签名（小写），无法识别时返回 null。 */
    private static String tagName(String rawTag) {
        int p = rawTag.startsWith("</") ? 2 : 1;
        int start = p;
        while (p < rawTag.length() && (Character.isLetterOrDigit(rawTag.charAt(p)) || rawTag.charAt(p) == '-')) {
            p++;
        }
        if (p == start) return null;
        return rawTag.substring(start, p).toLowerCase(Locale.ROOT);
    }

    /** 跳过 &lt;tag ...&gt; 到与之配对的 &lt;/tag&gt;；自闭合或无闭合则只跳过自身。 */
    private static int skipElement(String lowerHtml, int openStart, int openEnd, String tagName) {
        boolean selfClosing = lowerHtml.charAt(openEnd - 1) == '/';
        if (tagName == null || selfClosing) return openEnd + 1;

        String open = "<" + tagName;
        String close = "</" + tagName;
        int depth = 1;
        int cursor = openEnd + 1;
        while (cursor < lowerHtml.length()) {
            int nextOpen = lowerHtml.indexOf(open, cursor);
            int nextClose = lowerHtml.indexOf(close, cursor);
            if (nextClose < 0) return lowerHtml.length();
            if (nextOpen >= 0 && nextOpen < nextClose
                    && !lowerHtml.startsWith(close, nextOpen)) {
                depth++;
                cursor = nextOpen + open.length();
                continue;
            }
            depth--;
            cursor = nextClose + close.length();
            if (depth == 0) {
                int gt = lowerHtml.indexOf('>', cursor);
                return gt < 0 ? lowerHtml.length() : gt + 1;
            }
        }
        return lowerHtml.length();
    }

    private static String sanitizeTag(String tag) {
        boolean closing = tag.startsWith("</");
        boolean selfClose = tag.endsWith("/>");
        String inner = tag.substring(closing ? 2 : 1, tag.length() - (selfClose ? 2 : 1)).trim();

        // 标签名允许数字：h1~h6 是白名单成员，若只认字母会把 "h1" 截成 "h" 而误判为非法标签，
        // 导致标题被整段丢弃（曾出现「标题渲染成纯文本」的真实缺陷）。
        int sp = 0;
        while (sp < inner.length()
                && (Character.isLetterOrDigit(inner.charAt(sp)) || inner.charAt(sp) == '-')) {
            sp++;
        }
        if (sp == 0) return "";
        String name = inner.substring(0, sp).toLowerCase(Locale.ROOT);
        if (!ALLOWED_TAGS.contains(name)) return "";

        if (closing) return "</" + name + ">";

        String attrs = inner.substring(sp).trim();
        StringBuilder ab = new StringBuilder();
        Matcher m = ATTR.matcher(attrs);
        while (m.find()) {
            String an = m.group(1).toLowerCase(Locale.ROOT);
            if (URL_ATTRS.contains(an)) {
                String val = m.group(2);
                if (isSafeUrl(val)) {
                    ab.append(' ').append(an).append("=\"").append(escapeAttr(val)).append('"');
                }
            }
            // 其余属性（style / on* / 任意自定义）一律丢弃
        }
        return "<" + name + ab + (selfClose ? "/>" : ">");
    }

    /**
     * 仅允许 http(s)、站内相对路径、锚点与 mailto；拒绝 javascript:/data:/vbscript: 等。
     *
     * 严格性要求（宁拒绝不误放）：
     *  - 含空白、引号、尖括号、反引号一律拒绝——这类字符是属性逃逸的典型载体
     *    （例如 "http://e/x.png onerror=alert(1)" 若被当作合法 URL 写入 src，就会生成事件属性）；
     *  - 拒绝控制字符与反斜杠；
     *  - 协议必须以完整前缀匹配，避免 "javascript:" 之类被相对路径分支放过。
     */
    public static boolean isSafeUrl(String url) {
        if (url == null) return false;
        String u = url.trim();
        if (u.isEmpty() || u.length() > 2048) return false;
        for (int i = 0; i < u.length(); i++) {
            char c = u.charAt(i);
            if (c <= 0x20 || c == 0x7f) return false;          // 空白与控制字符
            if (c == '"' || c == '\'' || c == '<' || c == '>'
                    || c == '`' || c == '\\') return false;    // 属性逃逸载体
        }
        String lower = u.toLowerCase(Locale.ROOT);
        // 先判定显式的危险协议，防止被后面的相对路径分支误放
        if (lower.startsWith("javascript:") || lower.startsWith("data:")
                || lower.startsWith("vbscript:") || lower.startsWith("file:")) {
            return false;
        }
        return lower.startsWith("http://") || lower.startsWith("https://")
                || u.startsWith("/") || u.startsWith("#")
                || u.startsWith("./") || u.startsWith("../")
                || lower.startsWith("mailto:");
    }

    private static String escapeAttr(String value) {
        return value.replace("&", "&amp;").replace("\"", "&quot;");
    }
}
