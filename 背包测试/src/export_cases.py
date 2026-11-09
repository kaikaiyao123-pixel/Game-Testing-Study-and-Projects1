"""导出 100 条测试集为 CSV（UTF-8 BOM，便于 Excel / WPS 直接打开）。
字段覆盖源文档 3.1 的八要素，并附逐项验证结果与实际观测值。
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "outputs" / "verification_results.json"
OUT = ROOT / "outputs" / "测试集_100条.csv"

KIND = {"auto": "自动断言", "proxy": "代理验证", "manual": "人工/真机"}


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    base = d["baseline"]["results"]
    injected = {r["id"]: r["status"] for r in d["injected"]["results"]}
    assert len(base) == 100

    with OUT.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["编号", "所属模块", "用例标题", "前置条件", "操作步骤", "预期结果",
                    "设计方法", "优先级", "验证类型", "基准版状态", "实际观测值", "注入缺陷版状态"])
        for r in base:
            w.writerow([
                r["id"], r["group"], r["title"], r["pre"], r["steps"], r["expect"],
                r["method"], r["priority"], KIND.get(r["kind"], r["kind"]),
                r["status"], r["actual"], injected.get(r["id"], "")
            ])
    print(f"已写出 {OUT} ({OUT.stat().st_size/1024:.1f} KB, {len(base)} 条)")
    print("字段：编号/模块/标题/前置/步骤/预期/设计方法/优先级 = 文档 3.1 八要素；后 4 列为逐项验证结果")


if __name__ == "__main__":
    main()
