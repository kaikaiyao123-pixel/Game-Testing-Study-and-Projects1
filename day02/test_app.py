"""最小 Web UI 自动化测试脚本（pytest + Playwright 无头 Chromium）。

用例覆盖：登录成功、登录失败、未知用户、页面标题。
"""
from playwright.sync_api import expect


def test_login_success(page):
    """正确凭据 → 跳转并显示欢迎语。"""
    page.fill("#username", "admin")
    page.fill("#password", "secret")
    page.click("#submit")
    expect(page.locator("#welcome")).to_contain_text("欢迎, admin!")


def test_login_fail_shows_error(page):
    """密码错误 → 停留在登录页并显示错误提示。"""
    page.fill("#username", "admin")
    page.fill("#password", "wrong-password")
    page.click("#submit")
    expect(page.locator("#error")).to_contain_text("用户名或密码错误")


def test_unknown_user_fails(page):
    """用户不存在 → 同样显示错误提示。"""
    page.fill("#username", "nobody")
    page.fill("#password", "x")
    page.click("#submit")
    expect(page.locator("#error")).to_contain_text("用户名或密码错误")


def test_page_title(page):
    """首页标题正确。"""
    expect(page).to_have_title("最小登录页")
