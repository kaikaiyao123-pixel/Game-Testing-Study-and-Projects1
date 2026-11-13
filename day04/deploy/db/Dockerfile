# 把聚合迁移预置进官方 MySQL 初始化目录：首次创建数据卷时自动建齐 16 张表。
# 构建上下文为 deploy/db/，例如：
#   docker build -f deploy/db/Dockerfile -t blogg/mysql-with-schema:latest deploy/db
# 若 Docker Hub 不可达，可加 --build-arg MYSQL_BASE=<可达镜像源>/library/mysql:8.0
ARG MYSQL_BASE=mysql:8.0
FROM ${MYSQL_BASE}

COPY cloud-init.sql /docker-entrypoint-initdb.d/01-cloud-init.sql
