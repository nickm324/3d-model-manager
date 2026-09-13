FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/build.mjs scripts/build.mjs
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends openscad fonts-liberation libsmbclient smbclient \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./package.json
COPY server.mjs ./server.mjs
COPY smb-storage.mjs ./smb-storage.mjs
COPY model-info.mjs ./model-info.mjs
COPY auth.mjs ./auth.mjs
RUN mkdir -p /data/backups /data/renders /fallback-library && chown -R node:node /data /fallback-library
ENV NODE_ENV=production PORT=3210 HOST=0.0.0.0 LIBRARY_PATH=/fallback-library DATA_PATH=/data \
    LIBRARY_WRITABLE=true QT_QPA_PLATFORM=offscreen HOME=/tmp XDG_CACHE_HOME=/tmp UV_THREADPOOL_SIZE=16
USER node
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3210/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
