# 个人健康管理 · 单镜像部署（前端构建 + 后端同源托管）
# 用法见 health-app/DEPLOY.md；本地试跑：
#   docker build -t health-app . && docker run -p 3001:3001 --env-file server/.env health-app

# ---------- 1) 构建前端 ----------
FROM node:24-alpine AS web-build
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2) 运行后端（顺带托管 web/dist） ----------
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3001 \
    TZ=Asia/Shanghai
WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/ ./
COPY --from=web-build /build/dist /app/web/dist

# 数据目录：部署时挂持久卷，否则重新部署数据会丢
RUN mkdir -p /app/server/data /app/server/uploads /app/server/backups
VOLUME ["/app/server/data", "/app/server/uploads", "/app/server/backups"]

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
