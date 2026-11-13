# 生产前端镜像：静态资源 + /api 反向代理，对公网只暴露一个端口。
# 构建上下文必须是仓库根目录，例如：
#   docker build -f deploy/frontend/Dockerfile -t blogg/frontend:latest .
# 构建期会把 web/js/config.js 的 API_BASE 精确替换为同源空串（仅镜像内副本）。
ARG NODE_BASE=node:20-alpine
FROM ${NODE_BASE}

WORKDIR /app
COPY server/ ./server/
COPY web/ ./web/
COPY deploy/frontend/ ./deploy/frontend/

RUN node deploy/frontend/patch-config.js

ENV BLOG_HOST=0.0.0.0 \
    BLOG_FRONTEND_PORT=3000 \
    BACKEND_ORIGIN=http://backend:8081

EXPOSE 3000
CMD ["node", "deploy/frontend/server.js"]
