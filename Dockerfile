# ---- deps: install & compile native modules (better-sqlite3) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Build toolchain needed to compile better-sqlite3 from source
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --build-from-source

# ---- runtime: slim image with only what the API needs ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/market.db
WORKDIR /app

# Prebuilt node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Application source (see .dockerignore for what's excluded)
COPY package.json index.js swagger.js cloudinary.js ./
COPY db ./db
COPY routes ./routes
COPY middleware ./middleware

# Persisted data lives here (mounted as a volume in compose)
RUN mkdir -p /data /app/uploads

EXPOSE 3000

# Lightweight healthcheck against the storefront API
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/menu/categories').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
