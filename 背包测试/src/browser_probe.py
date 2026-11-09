"""用真实 Chrome headless 渲染主交付 HTML，DOM 探针回传权威结果。

不在交付目录留下临时文件；探针写到 _probe.html 副本，验证后删除。
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "outputs" / "背包系统_场景与逐项验证.html"
PROBE = ROOT / "outputs" / "_probe.html"


def find_chrome():
    """支持 CHROME_BIN 覆盖，并兼容 Windows / Linux / macOS 常见安装位置。"""
    env = os.environ.get("CHROME_BIN")
    if env and Path(env).exists():
        return Path(env)
    for p in (r"C:/Program Files/Google/Chrome/Application/chrome.exe",
              r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
              r"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        if Path(p).exists():
            return Path(p)
    for name in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge"):
        found = shutil.which(name)
        if found:
            return Path(found)
    return Path("__no_chrome__")


CHROME = find_chrome()

PROBE_JS = r"""
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var out = {};
    out.cells = document.querySelectorAll('#grid .cell').length;
    out.details = document.querySelectorAll('#results details').length;
    out.verdict = document.getElementById('verdict').textContent.replace(/\s+/g,' ').slice(0, 80);
    out.reverseRows = document.querySelectorAll('#reverseBox tr').length;
    out.externalScripts = document.querySelectorAll('script[src]').length;
    out.hOverflow = document.documentElement.scrollWidth - window.innerWidth;
    out.bodyBg = getComputedStyle(document.body).backgroundColor;
    out.gridWidth = Math.round(document.getElementById('grid').getBoundingClientRect().width);
    document.getElementById('bRunClean').click();
    out.afterRun = document.querySelectorAll('#results details').length;
    out.afterVerdict = document.getElementById('verdict').textContent.indexOf('验收通过') >= 0;
    document.getElementById('bKill').click();
    out.drops = document.querySelectorAll('#ground .drop').length;
    document.getElementById('bPickAll').click();
    out.filledCells = document.querySelectorAll('#grid .cell.has').length;
    var d = document.createElement('div');
    d.id = '__probe__';
    d.textContent = 'PROBE ' + JSON.stringify(out);
    document.body.appendChild(d);
  }, 400);
});
</script>
"""


def main():
    if not CHROME.exists():
        print("未找到 Chrome/Edge，跳过真实浏览器验证")
        return
    html = PAGE.read_text(encoding="utf-8")
    PROBE.write_text(html.replace("</body>", PROBE_JS + "</body>"), encoding="utf-8")

    cmd = [str(CHROME), "--headless=new", "--disable-gpu", "--no-sandbox",
           "--virtual-time-budget=7000", "--dump-dom", PROBE.as_uri()]
    try:
        with tempfile.TemporaryDirectory() as td:
            cmd.append("--user-data-dir=" + td)
            r = subprocess.run(cmd, capture_output=True, timeout=120)
        dom = r.stdout.decode("utf-8", errors="replace")
        m = re.search(r"PROBE (\{.*?\})", dom)
        if not m:
            print("浏览器探针未回传结果（stderr 摘要）:")
            print(r.stderr.decode("utf-8", errors="replace")[:800])
            raise SystemExit(1)
        out = json.loads(m.group(1))
    finally:
        PROBE.unlink(missing_ok=True)

    print("真实浏览器 DOM 探针结果：")
    for k, v in out.items():
        print(f"  {k}: {v}")

    checks = [
        ("背包网格渲染 200 格", out["cells"] == 200),
        ("结果列表渲染 100 条", out["details"] == 100),
        ("验收结论正确", "验收通过" in out["verdict"]),
        ("反向测试表 6 行数据", out["reverseRows"] == 7),
        ("零外部脚本（离线自包含）", out["externalScripts"] == 0),
        ("无横向溢出", out["hOverflow"] <= 0),
        ("浅色主题背景", out["bodyBg"] in ("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)", "white")),
        ("浏览器内重跑验证成功", out["afterRun"] == 100 and out["afterVerdict"]),
        ("游戏场景可交互（掉落→拾取）", out["drops"] > 0 and out["filledCells"] > 0),
    ]
    bad = [n for n, ok in checks if not ok]
    for n, ok in checks:
        print(f'  {"OK  " if ok else "FAIL"} {n}')
    if bad:
        print("浏览器验证未通过：" + ", ".join(bad))
        raise SystemExit(1)
    print("浏览器验证全部通过；临时探针文件已清理")


if __name__ == "__main__":
    main()
