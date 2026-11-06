"""共享 fixture：启动被测 Flask 应用 + 准备无头浏览器页面。"""
import socket
import threading

import pytest
from playwright.sync_api import sync_playwright

from app import app as flask_app


def _free_port():
    """分配一个空闲端口给被测应用。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def base_url():
    """在后台线程启动被测 Flask 应用，返回其 base url。"""
    port = _free_port()
    thread = threading.Thread(
        target=flask_app.run,
        kwargs={
            "host": "127.0.0.1",
            "port": port,
            "debug": False,
            "use_reloader": False,
        },
        daemon=True,
    )
    thread.start()
    yield f"http://127.0.0.1:{port}"


@pytest.fixture(scope="session")
def browser():
    """启动 Playwright 无头 Chromium（指向系统已装的 chromium）。"""
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path="/usr/local/bin/chromium",
        )
        yield browser
        browser.close()


@pytest.fixture()
def page(browser, base_url):
    """每个用例一个独立标签页，并打开被测应用首页。"""
    context = browser.new_context()
    page = context.new_page()
    page.goto(base_url)
    yield page
    context.close()
