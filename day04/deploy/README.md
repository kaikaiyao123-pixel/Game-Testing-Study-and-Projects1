# 部署产物（Zeabur 方案 A′ 落地）

对应评估：`docs/Zeabur方案A评估.md`。本目录提供「可一键运行的生产化编排」与「Zeabur 官方模板」，且**不修改仓库既有源码 / 迁移 / 验收脚本**（57 文件基线保持 `diffs=0`）。

## 目录结构

```
deploy/
  docker-compose.prod.yml     # 本机 / 单机生产化 4 服务编排（已实测可用）
  frontend/
    Dockerfile                # 前端镜像：Node + 静态资源 + 构建期配置替换
    server.js                 # 静态资源 + /api 反向代理，复用 server/static.js
    patch-config.js           # 构建期把 API_BASE 精确替换为同源空串（带断言 + 反向测试）
  backend/
    Dockerfile.runtime        # 运行时镜像，复用 backend/target/blog-backend.jar
  db/
    Dockerfile                # 把 cloud-init.sql 预置进 MySQL 初始化目录
    cloud-init.sql            # 自动生成：init.sql + V1..V5（16 张表，幂等）
    build-cloud-init.js       # 生成器 + 自检 + 反向测试
    verify.sql                # 部署后校验表数
  zeabur/
    template.yaml             # 平台官方模板（替换镜像占位符后部署）
```

## 设计要点（为什么这样改）

1. **同源反代**：前端容器同时托管静态页与 `/api`，浏览器不再跨域；因此不需要把后端域名写死进前端，规避 `selfcheck.js` 的零外链断言。
2. **构建期替换**：`API_BASE` 只在镜像内副本改成空串，仓库源码仍保留 `http://127.0.0.1:8081`，本机开发栈不受影响，57 文件基线 `diffs=0`。
3. **聚合迁移**：`cloud-init.sql` 按 `init.sql → V1 → V2 → V3 → V4 → V5` 只读拼接，未改动任何 `db/` 原文件（项目硬契约：禁改 `init.sql` 与 V1–V4）；挂到 MySQL 初始化目录后，首次建卷自动建 16 张表。
4. **端口错开**：生产编排用 `3100 / 8082 / 3307 / 6380`，与开发栈 `3000 / 8081 / 3306 / 6379` 并存不冲突。

## A. 本机一键验证（推荐先跑）

```bash
cd /f/blogg

# Docker Hub 不可达时，给 JRE 基础镜像指定镜像源（本地已拉到可省略）
export JRE_BASE=docker.m.daocloud.io/library/eclipse-temurin:17-jre

docker compose -f deploy/docker-compose.prod.yml up -d --build

# 打开页面
# http://127.0.0.1:3100/login.html
```

校验：

```bash
# 16 张表（期望 table_count = 16）
docker compose -f deploy/docker-compose.prod.yml exec -T mysql \
  mysql -uroot -pblog_root_2026 --default-character-set=utf8mb4 blog < deploy/db/verify.sql

# 健康检查与首屏接口
curl --noproxy '*' -s http://127.0.0.1:3100/api/health
curl --noproxy '*' -s http://127.0.0.1:3100/api/home/summary
```

停止：`docker compose -f deploy/docker-compose.prod.yml down`（保留数据卷可去掉 `--volumes`）。

## B. Zeabur 部署（把项目放到公网）

1. 登录：`npx zeabur@latest auth login`
2. 构建并推送 3 个镜像（把 `OWNER` 换成你的用户名 / 组织）：

   ```bash
   docker build -f deploy/db/Dockerfile                 -t ghcr.io/OWNER/blogg-mysql-with-schema:latest deploy/db
   docker build -f deploy/backend/Dockerfile.runtime    -t ghcr.io/OWNER/blogg-backend:latest .
   docker build -f deploy/frontend/Dockerfile           -t ghcr.io/OWNER/blogg-frontend:latest .
   docker push ghcr.io/OWNER/blogg-mysql-with-schema:latest
   docker push ghcr.io/OWNER/blogg-backend:latest
   docker push ghcr.io/OWNER/blogg-frontend:latest
   ```

3. 替换模板里的 3 处镜像占位符：

   ```bash
   sed -i 's#ghcr.io/OWNER#ghcr.io/你的用户名#' deploy/zeabur/template.yaml
   ```

4. 部署：`npx zeabur@latest template deploy -f deploy/zeabur/template.yaml`
5. 控制台：给 `frontend` 绑定域名（`PUBLIC_DOMAIN`）；确认 MySQL 已自动建 16 张表，否则手工导入：

   ```bash
   mysql -h <host> -P <port> -u <user> -p <db> < deploy/db/cloud-init.sql
   ```

6. 验收：访问 frontend 域名的 `/api/health`、`/api/home/summary`。

## C. VPS / 云服务器生产化部署（路径 B，常驻单入口）

适合「想要真正常驻、公网可访问、且不想用 Zeabur 托管」的诉求。在路径 A′ 基础上再叠一层 nginx 做 TLS 终止 + 反向代理，**mysql / redis 端口不发布到宿主机**（仅在内部网络互通），缩小攻击面。

```bash
cd /f/blogg
cp deploy/vps/.env.example deploy/vps/.env   # 改 BLOG_DOMAIN 与三处强口令
# 把证书放到 deploy/vps/certs/fullchain.pem 与 deploy/vps/certs/privkey.pem
docker compose -f deploy/vps/docker-compose.vps.yml --env-file deploy/vps/.env up -d --build
```

要点：

- **单入口**：浏览器只访问 443；nginx 终止 TLS 后把全部请求（含已同源反代的 `/api`）转发到 `frontend:3000`。mysql / redis 不暴露公网。
- **数据库迁移已烘焙进镜像**：`deploy/db/Dockerfile` 把 `cloud-init.sql`（init.sql + V1–V5）预置进 MySQL 初始化目录，首次建卷自动建 16 张表，无需手工导入。
- **证书**：用 `certbot certonly --webroot -w deploy/vps/certs ...` 或 `--nginx` 申请 Let's Encrypt；自签仅测试。nginx 已配置 80→443 强制跳转与基础安全头。
- **本机验证已通过**：临时起 nginx 反代复用既有 frontend 容器，`login.html` / `home.html` / `css/common.css` 经 8088 全 200，`/api/health` 与 `/api/home/summary` 经 `nginx → frontend → backend` 正常返回（测试容器与临时配置已清理）。

停止：`docker compose -f deploy/vps/docker-compose.vps.yml down`（保留数据卷去掉 `--volumes`）。

备份建议（生产必做，Zeabur Free Plan 无自动备份）：

```bash
# MySQL 逻辑备份（--set-gtid-purged=OFF 适配 8.0）
docker compose -f deploy/vps/docker-compose.vps.yml exec -T db \
  mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 --set-gtid-purged=OFF blog > backup-$(date +%F).sql
# Redis 落盘已在 redis.conf 开启 appendonly；持久卷 redis_data 单独备份即可
```

## 限制与风险

- **Free Plan 服务空闲自动休眠**，首次唤醒有数秒冷启动；官方**无 SLA、无自动数据库备份 / 导入**。演示数据丢失不可恢复。
- 默认口令 `blog_pass_2026` / `blog_root_2026` 仅供演示；上线前改为强口令，或依赖 Zeabur 模板内置的 `${PASSWORD}`（模板已使用）。
- 同源反代下 CORS 可选；模板里 `backend` 的 `CORS_ALLOWED_ORIGINS` 设为 `*`，可在控制台收紧为前端域名。
- **Zeabur 模板字段以官方 schema 为准**（`deploy/zeabur/template.yaml` 已按官方指南编写，但未经真机部署验证）；若控制台报字段错误，按提示调整，或先用 `npx zeabur template deploy -f` 本地校验。
- **本机 `docker-compose.prod.yml` 已实测通过**；Zeabur 侧为按平台规范产出的等价编排。
