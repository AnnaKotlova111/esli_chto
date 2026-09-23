# syntax=docker/dockerfile:1
# «Если что»: мини-приложение (статика) и бот MAX в одном контейнере.
# Сборка: зависимости → мини-приложение (Vite) + бот (esbuild в один файл).
# В итоговый образ попадают только собранные файлы – без исходников и node_modules.
FROM node:24-alpine AS build
WORKDIR /app

# 1) зависимости – отдельным слоем, чтобы кэшировались при правках кода
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/webapp/package.json apps/webapp/
COPY apps/bot/package.json apps/bot/
RUN npm ci --no-audit --no-fund

# 2) исходники и сборка
COPY packages packages
COPY apps apps
# Публичный корневой сертификат Минцифры: им подписан API MAX, встраивается в сборку бота
COPY deploy/russian_trusted_root_ca.pem deploy/russian_trusted_root_ca.pem
RUN npm run build

# ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEBAPP_DIST=/app/webapp
WORKDIR /app
COPY --from=build /app/apps/bot/dist/server.mjs ./server.mjs
COPY --from=build /app/apps/webapp/dist ./webapp
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
