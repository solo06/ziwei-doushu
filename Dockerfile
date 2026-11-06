# syntax=docker/dockerfile:1
# 三阶段构建：装依赖 → 编译 → 精简运行镜像

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# 默认走官方源；国内构建可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY" \
 && npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* 会在构建时内联进产物。
# 留空则使用 lib/site.ts 的默认值 http://localhost:3000，不会指向任何人的域名。
ARG NEXT_PUBLIC_SITE_URL=
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Shanghai
RUN apk add --no-cache tzdata
COPY package.json package-lock.json .npmrc ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.js ./next.config.js
# 运行期不需要 tailwind / typescript / postcss
RUN npm prune --omit=dev && npm cache clean --force

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
