# 最小 Web UI 自动化测试案例

一个最小可运行的示例：**Flask 登录页（被测对象） + pytest + Playwright（无头 Chromium）的 Web UI 自动化测试**。

## 文件结构

```
webui_demo/
├── app.py            # 被测 Web 应用：极简登录页（admin / secret）
├── conftest.py       # 共享 fixture：后台启动 Flask + 准备无头浏览器
├── test_app.py       # Web UI 测试用例（登录成功/失败/未知用户/标题）
└── requirements.txt  # 依赖
```

## 安装依赖

```bash
pip install -r requirements.txt
```

> Playwright 需要浏览器内核。本机已装 chromium 时，`conftest.py` 通过
> `executable_path="/usr/local/bin/chromium"` 直接复用；也可用
> `python -m playwright install chromium` 安装自带的浏览器内核后，去掉该参数。

## 运行测试

```bash
cd webui_demo
python -m pytest -v
```

预期 4 个用例全部通过。可用 `-k 名称` 只跑某个用例，例如：

```bash
python -m pytest -v -k login_success
```

## 手动查看被测应用

```bash
cd webui_demo
python app.py            # 启动后访问 http://127.0.0.1:5000
```

## 怎么改成你真实的被测系统

1. `conftest.py` 中把 `base_url` 改成你系统的地址（去掉启动 Flask 的逻辑）；
2. 把 `test_app.py` 里的选择器/断言换成你页面上真实的控件与文案；
3. 若被测页面需要登录态，在 `page` fixture 里先完成登录。
