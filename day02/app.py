"""最小被测 Web 应用：一个极简登录页，作为 Web UI 自动化测试的对象。"""
from flask import Flask, render_template_string, request

app = Flask(__name__)

# 充当"数据库"的极简账户表
USERS = {"admin": "secret"}

INDEX_HTML = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>最小登录页</title>
</head>
<body>
  <h1 id="title">登录</h1>
  <form method="post" action="/login">
    <label>用户名 <input type="text" name="username" id="username"></label><br>
    <label>密码 <input type="password" name="password" id="password"></label><br>
    <button type="submit" id="submit">登录</button>
  </form>
  <p id="error" style="color:red">{{ error }}</p>
</body>
</html>
"""

WELCOME_HTML = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>欢迎</title>
</head>
<body>
  <h1 id="welcome">欢迎, {{ username }}!</h1>
  <a href="/">返回</a>
</body>
</html>
"""


@app.route("/")
def index():
    return render_template_string(INDEX_HTML, error="")


@app.route("/login", methods=["POST"])
def login():
    username = request.form.get("username", "")
    password = request.form.get("password", "")
    if USERS.get(username) == password:
        return render_template_string(WELCOME_HTML, username=username)
    return render_template_string(INDEX_HTML, error="用户名或密码错误")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
