# Zeabur「方案 A」可行性评估

> 评估日期：2026-11-13
> 评估对象：把现有 `docker-compose.yml` 直接上传 Zeabur 一键部署
> 结论：**该方案不成立**。平台不支持直接上传 Compose 文件；且本仓库的 Compose 也不是一份完整的应用编排。

## 1. 结论摘要

方案 A 包含两个前提，经核查均不成立：

1. 「直接上传 docker-compose.yml，一键部署」——Zeabur 不解析 Compose 文件，需改写为平台专用 `template.yaml`。
2. 「马上就能跑 mysql+redis」——这句描述恰好说明默认编排只启动中间件：当前 `backend` 位于 `profiles: ["containerized"]`，默认不启动；仓库中也没有 frontend 服务与前端镜像。

因此，直接上传的结果至多是得到两个无法从公网访问的中间件容器，不会得到可访问的博客站点。

## 2. 平台侧事实

| 事实 | 依据 |
| --- | --- |
| Zeabur 不支持 Docker Compose，需使用平台专用 YAML 模板 | 官方模板仓库 `zeabur/zeabur-template-doc` 提供《Docker Compose 转换指南》；社区文档明确「由于 Zeabur 不支持 docker compose，需编写平台专用 YAML 格式模板」 |
| 服务来源为 Docker 镜像或 Git 代码 | 官方模板文档；OceanBase 一键部署模板说明 |
| Compose 字段需逐项重写 | `services` 字典 → `spec.services[]` 数组；`ports` → `{id, port, type: HTTP\|TCP}`；`environment` → `env.KEY.default`；`depends_on` → `dependencies[]`；`healthcheck` → `spec.init[]`；服务名 DNS → `${CONTAINER_HOSTNAME}` + `expose: true` |
| 不直接支持共享 Volume、healthcheck、`build`、`extends` | 官方转换指南「不支持或需人工处理」表 |
| Free Plan 空闲自动休眠，请求唤醒有数秒冷启动；无 SLA；无自动数据库备份/导入、无日志转发 | 官方 Pricing / Free Plan 文档（2026-06-22） |
| 订阅档位 Free $0 / Dev $5 / Pro $19 / Team $79（月） | 官方 Pricing（2026-06-22） |

注：第三方资料对「免费版可部署的非静态服务数量与额度」口径不一致，实际以 Zeabur 控制台当前额度为准。

## 3. 仓库侧事实（逐条证据）

| # | 文件与行 | 现状 | 云端后果 |
| --- | --- | --- | --- |
| 1 | `docker-compose.yml:44-45` | `backend` 带 `profiles: ["containerized"]` | 默认 `up` 不启动后端 |
| 2 | `docker-compose.yml:6-73` | 只有 mysql / redis / backend；无 frontend；仓库无前端 Dockerfile | 无页面入口 |
| 3 | `docker-compose.yml:18, 34, 64` | 端口均绑 `127.0.0.1` | 云平台健康检查与域名转发无法进入容器 |
| 4 | `docker-compose.yml:21`、`db/init.sql:10` | 只挂 `init.sql`，且仅在数据卷首次初始化执行；只建 `user` 一张表 | 16 张表中的 15 张缺失，`/api/home/summary` 报 `Table 'blog.media_item' doesn't exist`（本机已实测 500） |
| 5 | `db/migrations/V1..V5` | 五份迁移未被 Compose 挂载 | 新卷不会自动建表；项目硬契约禁止修改 `init.sql` 与 V1–V4 |
| 6 | `backend/Dockerfile:8-10` | 构建上下文 `./backend`，仅 `COPY pom.xml` 与 `COPY src` | 镜像内不含 `db/`，无法在容器内自动执行迁移 |
| 7 | `web/js/config.js:30` | `API_BASE: 'http://127.0.0.1:8081'` 硬编码 | 云端浏览器会请求访客本机的 8081，而非 Zeabur 后端 |
| 8 | `tools/selfcheck.js:93` | 静态自检把 `http(s)://` 视为外部资源 | 把云端绝对域名硬编码进前端会与「零外链」验收约束冲突 |
| 9 | `server/frontend.js:15, 37`；`server/config.js:24` | 端口取 `BLOG_FRONTEND_PORT`（默认 3000），HOST 取 `BLOG_HOST`（默认 `127.0.0.1`） | 需显式设 `BLOG_HOST=0.0.0.0`，并把端口对齐平台注入的 `PORT` |
| 10 | `server/static.js:36-38` | 只处理 GET/HEAD 静态文件，不代理 `/api` | 要做同源免跨域，必须新增反向代理逻辑 |
| 11 | `backend/src/main/resources/application.yml:3, 29` | `server.address=0.0.0.0`；`CORS_ALLOWED_ORIGINS` 默认 `*` | 后端本身可入容器；生产应收紧 CORS 到前端域名 |

## 4. 免费版休眠的实际影响（比「慢一点」更严重）

- MySQL / Redis 若作为独立 Free 服务同样会被休眠，后端冷启动首次取连接会失败；`application.yml:17` 的 `initialization-fail-timeout: 60000` 只提供有限容忍，不能替代健康检查。
- 免费版无自动数据库备份/导入：演示数据丢失后不可恢复，且迁移需要人工执行。
- 冷启动期间 `/api/home/summary` 等首屏请求可能先失败，前端落到 `web/js/api.js:75` 的连接错误文案。
- 官方模板转换要求用 `spec.init[]` 等待依赖就绪，可用于缓解，但需要镜像内具备相应客户端工具。

## 5. 三条路径的客观对比

| 路径 | 前提 | 改动量 | 优点 | 局限 |
| --- | --- | --- | --- | --- |
| A′ Zeabur 原生模板 | 接受平台专用 YAML，不用 Compose | 新增 3 个文件 + 改 2 个文件 + 1 次 SQL 导入 | 无需备案，`.zeabur.app` 域名，平台托管 | 免费版休眠；无自动备份；模板需按 schema 验证；服务数多、资源额度受限 |
| B 云服务器 + 生产化 Compose | 有 VPS；国内域名需备案 | 新增 1 份生产 Compose + 前端镜像 + 反代 | 真正一键、常驻、数据可控 | 需服务器与运维，国内访问需备案 |
| C 本机 + 内网穿透 | 本机常开 | 零改造（现用 `bash start-stack.sh --foreground`） | 最快演示，验收脚本可直接跑 | 依赖本机在线，穿透链路稳定性受第三方影响 |

用户诉求是「不想备案、快速试跑、学习演示」：路径 C 的匹配度最高；若目标是「把项目真正放到公网并保留 Zeabur」，应走 A′，而不是方案 A 原文。

## 6. 若坚持 Zeabur：最小改造清单

以**新增文件优先**，不触碰 57 文件基线（除非明确选择改造 `web/js/config.js`）：

1. `deploy/zeabur/template.yaml`：按官方 schema 定义 4 个服务（mysql、redis、backend、frontend）。要点：`ports` 用 `id/port/type`；`depends_on` 改 `dependencies`；`healthcheck` 改 `spec.init` 等待 MySQL；服务间地址用 `${CONTAINER_HOSTNAME}` 暴露变量；MySQL 密码用 `${PASSWORD}`；卷用 `spec.volumes[{id,dir}]`；公开 URL 用 `${ZEABUR_WEB_URL}`。
2. `deploy/frontend/Dockerfile`：Node 22-alpine，`COPY server/ web/`，`ENV BLOG_HOST=0.0.0.0`，`BLOG_FRONTEND_PORT` 对齐平台 `PORT`，`CMD ["node","server/frontend.js"]`。
3. `deploy/db/cloud-init.sql`：按 `db/init.sql` → V1 → V2 → V3 → V4 → V5 顺序**只读拼接**成一次性导入脚本，不改动任何原迁移文件。
4. 前端 API 地址二选一：
   - 推荐（同源）：`server/frontend.js` 增加 `/api` 反代到 backend，`web/js/config.js` 的 `API_BASE` 置 `''`。零跨域、零外链、CORS 可收紧；代价是改 2 个既有文件，需刷新 `p0-baseline.json` 并跑 `selfcheck.js` / `ui-probe.js`。
   - 备选（跨域）：给 backend 绑定独立域名，把 `API_BASE` 改为运行时注入（`window.BLOG_CONFIG` 由服务端模板生成），`CORS_ALLOWED_ORIGINS` 设为前端域名。改造面更大且要处理零外链断言。
5. 环境变量：`MYSQL_HOST/MYSQL_PORT/MYSQL_DATABASE/MYSQL_USER/MYSQL_PASSWORD`、`REDIS_HOST/REDIS_PORT`、`BLOG_HOST=0.0.0.0`、`BLOG_FRONTEND_PORT`、`CORS_ALLOWED_ORIGINS`。

## 7. 部署后必须执行的一次性动作

```bash
# 用 Zeabur 控制台给出的连接信息导入迁移（V1–V5 顺序不可颠倒）
mysql -h <host> -P <port> -u <user> -p <db> < deploy/db/cloud-init.sql

# 验收：16 张表 + 健康检查 + 首屏接口
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='blog';  -- 期望 16
curl --noproxy '*' -s https://<frontend-domain>/api/health
curl --noproxy '*' -s https://<frontend-domain>/api/home/summary
```

## 8. 风险与验收建议

- 不要在云端沿用默认口令 `blog_pass_2026` / `blog_root_2026`；模板用 `${PASSWORD}` 生成。
- 前端素材 `web/assets/wallpaper-preview.mp4` 约 3.5 MB，冷启动首屏需关注带宽与时延；`prefers-reduced-motion` 分支已有兜底。
- 上线前在本机跑固定五套验收（selfcheck / render-probe / ui-probe / apitest / verify-stack），尤其确认 `p0-baseline.json` 的 `diffs=0`。
- 免费版仅适合演示，不建议承载真实数据；官方明确无 SLA 与无自动备份。

---

本评估为只读结论，未修改任何现有源码、迁移或验收脚本。
