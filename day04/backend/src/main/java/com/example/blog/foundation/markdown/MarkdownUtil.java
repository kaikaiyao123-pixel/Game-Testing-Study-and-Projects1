package com.example.blog.foundation.markdown;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * P2 最小安全 Markdown → HTML 渲染器（§F2 编辑、§5.8 XSS 防护）。
 *
 * 安全策略分三层：
 *  1) 正文一律先按字符转义（& < > "），用户提交的原始 HTML 只能作为普通文本出现；
 *  2) 只由本类产出受控标签（p/h/strong/em/code/pre/blockquote/ul/ol/li/a/img/hr），
 *     链接与图片 URL 必须通过 HtmlSanitizer.isSafeUrl；
 *  3) 最终整体再过一遍 HtmlSanitizer，兜底剔除任何意外标签或属性。
 *
 * 不支持原始 HTML 透传——这是有意为之：一旦允许透传，服务端净化的边界就变成
 * 「前端渲染器是否完备」，而这是无法穷举的。
 */
public final class MarkdownUtil {

    private static final Pattern FENCE = Pattern.compile("^```(\\w*)\\s*$");
    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.*)$");
    private static final Pattern HR = Pattern.compile("^(?:-{3,}|\\*{3,}|_{3,})$");
    private static final Pattern UL = Pattern.compile("^\\s*[-*+]\\s+(.*)$");
    private static final Pattern OL = Pattern.compile("^\\s*\\d+\\.\\s+(.*)$");
    private static final Pattern QUOTE = Pattern.compile("^>\\s?(.*)$");
    // URL 部分限定为不含空白：若允许空白，" onerror=alert(1)" 就能混进 src 造成属性逃逸。
    private static final Pattern IMAGE = Pattern.compile("!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)");
    private static final Pattern LINK = Pattern.compile("\\[([^\\]]+)\\]\\(([^)\\s]+)\\)");
    private static final Pattern CODE = Pattern.compile("`([^`]+)`");
    private static final Pattern BOLD = Pattern.compile("\\*\\*([^*]+)\\*\\*");
    private static final Pattern ITALIC = Pattern.compile("\\*([^*]+)\\*");

    private MarkdownUtil() {
    }

    public static String toHtml(String markdown) {
        if (markdown == null || markdown.isEmpty()) return "";
        String[] lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n", -1);

        StringBuilder out = new StringBuilder();
        int i = 0;
        boolean inFence = false;
        StringBuilder fenceBuf = new StringBuilder();
        String fenceLang = "";

        while (i < lines.length) {
            String line = lines[i];

            Matcher fence = FENCE.matcher(line);
            if (fence.matches()) {
                if (!inFence) {
                    inFence = true;
                    fenceLang = fence.group(1) == null ? "" : fence.group(1);
                    fenceBuf.setLength(0);
                } else {
                    out.append("<pre><code>")
                            .append(escape(fenceBuf.toString()))
                            .append("</code></pre>");
                    inFence = false;
                }
                i++;
                continue;
            }
            if (inFence) {
                fenceBuf.append(line).append("\n");
                i++;
                continue;
            }

            if (line.trim().isEmpty()) {
                i++;
                continue;
            }

            Matcher h = HEADING.matcher(line);
            if (h.matches()) {
                int level = h.group(1).length();
                // 标题文本尚未转义，走 inline() 正常路径（转义 + 行内标记）
                out.append("<h").append(level).append(">")
                        .append(inline(h.group(2)))
                        .append("</h").append(level).append(">");
                i++;
                continue;
            }

            if (HR.matcher(line).matches()) {
                out.append("<hr>");
                i++;
                continue;
            }

            Matcher q = QUOTE.matcher(line);
            if (q.matches()) {
                StringBuilder buf = new StringBuilder();
                while (i < lines.length) {
                    Matcher qm = QUOTE.matcher(lines[i]);
                    if (!qm.matches()) break;
                    buf.append(qm.group(1)).append("\n");
                    i++;
                }
                out.append("<blockquote>").append(inline(buf.toString().trim())).append("</blockquote>");
                continue;
            }

            Matcher u = UL.matcher(line);
            if (u.matches()) {
                StringBuilder buf = new StringBuilder();
                while (i < lines.length) {
                    Matcher um = UL.matcher(lines[i]);
                    if (!um.matches()) break;
                    buf.append("<li>").append(inline(um.group(1))).append("</li>");
                    i++;
                }
                out.append("<ul>").append(buf).append("</ul>");
                continue;
            }

            Matcher o = OL.matcher(line);
            if (o.matches()) {
                StringBuilder buf = new StringBuilder();
                while (i < lines.length) {
                    Matcher om = OL.matcher(lines[i]);
                    if (!om.matches()) break;
                    buf.append("<li>").append(inline(om.group(1))).append("</li>");
                    i++;
                }
                out.append("<ol>").append(buf).append("</ol>");
                continue;
            }

            // 段落：聚合连续普通行
            StringBuilder para = new StringBuilder();
            while (i < lines.length && !lines[i].trim().isEmpty()
                    && !FENCE.matcher(lines[i]).matches()
                    && !HEADING.matcher(lines[i]).matches()
                    && !HR.matcher(lines[i]).matches()
                    && !QUOTE.matcher(lines[i]).matches()
                    && !UL.matcher(lines[i]).matches()
                    && !OL.matcher(lines[i]).matches()) {
                if (para.length() > 0) para.append("\n");
                para.append(lines[i]);
                i++;
            }
            out.append("<p>").append(inline(para.toString())).append("</p>");
        }

        if (inFence) {
            // 未闭合代码块按普通文本兜底
            out.append("<pre><code>").append(escape(fenceBuf.toString())).append("</code></pre>");
        }

        return HtmlSanitizer.sanitize(out.toString());
    }

    /** 转义 + 行内标记（加粗 / 斜体 / 代码 / 链接 / 图片）。 */
    private static String inline(String text) {
        return inlineFromEscaped(escape(text));
    }

    /**
     * 对已转义文本执行行内标记替换。
     *
     * 行内代码必须最先抽出为占位符，否则代码里的 * 与 [ 会被加粗 / 斜体 / 链接规则误伤。
     * 占位符用 \u0000 包裹——该字符不会出现在正常文本里，不会与正文冲突。
     */
    private static String inlineFromEscaped(String escaped) {
        String s = replaceUrl(IMAGE, escaped, true);

        List<String> codes = new ArrayList<>();
        Matcher cm = CODE.matcher(s);
        StringBuffer cb = new StringBuffer();
        while (cm.find()) {
            int idx = codes.size();
            codes.add(cm.group(1)); // 已转义，直接复用
            cm.appendReplacement(cb, Matcher.quoteReplacement("\u0000C" + idx + "\u0000"));
        }
        cm.appendTail(cb);
        s = cb.toString();

        s = BOLD.matcher(s).replaceAll("<strong>$1</strong>");
        s = ITALIC.matcher(s).replaceAll("<em>$1</em>");
        s = replaceUrl(LINK, s, false);

        for (int k = codes.size() - 1; k >= 0; k--) {
            s = s.replace("\u0000C" + k + "\u0000", "<code>" + codes.get(k) + "</code>");
        }
        return s;
    }

    private static String replaceUrl(Pattern pattern, String escaped, boolean image) {
        Matcher m = pattern.matcher(escaped);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String label = m.group(1);
            String url = m.group(2);
            if (HtmlSanitizer.isSafeUrl(url)) {
                if (image) {
                    m.appendReplacement(sb, Matcher.quoteReplacement(
                            "<img src=\"" + escapeAttr(url) + "\" alt=\"" + escapeAttr(label) + "\">"));
                } else {
                    m.appendReplacement(sb, Matcher.quoteReplacement(
                            "<a href=\"" + escapeAttr(url) + "\">" + label + "</a>"));
                }
            } else {
                // URL 不合法：整体原样保留为已转义的文本
                m.appendReplacement(sb, Matcher.quoteReplacement(m.group(0)));
            }
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private static String escapeAttr(String s) {
        return escape(s).replace("'", "&#39;");
    }
}
