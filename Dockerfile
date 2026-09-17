# ===== 构建阶段 =====
FROM node:20-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# 复制源代码并构建
COPY . .
RUN npm run build

# ===== 运行阶段 =====
FROM node:20-alpine

WORKDIR /app

# 安装 wrangler（运行时需要）
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --omit=optional && npm cache clean --force

# 复制构建产物和必要文件
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY migrations ./migrations
COPY wrangler.jsonc ./

# 创建数据库目录
RUN mkdir -p /app/.wrangler/state/v3/d1

# 启动脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

ENTRYPOINT ["/docker-entrypoint.sh"]
