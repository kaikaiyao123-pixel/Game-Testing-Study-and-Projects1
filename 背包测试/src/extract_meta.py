"""从源学习包 HTML 中提取 100 条用例清单，生成 cases_meta.js。

元数据（编号 / 标题 / 设计方法 / 优先级 / 分组）一律以源文档为准，
避免人工转录产生偏差。此脚本是构建链的第一步。
"""
import re
import html
import json
from pathlib import Path

# 交付包内携带源学习包副本（docs/），路径相对本文件解析，
# 保证 clone 到任意机器后都能独立复现，不依赖原开发机的绝对路径。
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "第一周学习包_测试理论与背包样例.html"
OUT = Path(__file__).with_name("cases_meta.js")


def main():
    text = SRC.read_text(encoding="utf-8")
    table = re.search(r'<table class="long" id="cases100">.*?</table>', text, re.S)
    if not table:
        raise SystemExit("未找到 cases100 表格")

    cases = []
    group = ""
    for row in re.findall(r"<tr.*?</tr>", table.group(0), re.S):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in cells]
        if not cells:
            continue
        if len(cells) == 1:
            group = re.sub(r"（\s*\d+\s*条）", "", cells[0]).strip()
            continue
        if cells[0] in ("编号", ""):
            continue
        cid, title, method, priority = cells[:4]
        cases.append({
            "id": cid,
            "group": group,
            "title": title,
            "method": method,
            "priority": priority,
        })

    assert len(cases) == 100, f"应提取 100 条，实际 {len(cases)}"
    assert len({c["id"] for c in cases}) == 100, "存在重复编号"
    groups = {}
    for c in cases:
        groups[c["group"]] = groups.get(c["group"], 0) + 1
    print("分组统计:", json.dumps(groups, ensure_ascii=False))

    payload = json.dumps(cases, ensure_ascii=False, indent=2)
    OUT.write_text(
        "// 由 extract_meta.py 从源学习包自动生成，请勿手工编辑。\n"
        "(function (root, factory) {\n"
        "  var api = factory();\n"
        "  if (typeof module === 'object' && module.exports) module.exports = api;\n"
        "  else root.CasesMeta = api;\n"
        "})(typeof globalThis !== 'undefined' ? globalThis : this, function () {\n"
        "  'use strict';\n"
        "  return " + payload + ";\n"
        "});\n",
        encoding="utf-8",
    )
    print(f"已写出 {OUT} （{len(cases)} 条）")


if __name__ == "__main__":
    main()
