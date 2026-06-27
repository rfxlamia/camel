FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm ci --workspace=server --ignore-scripts

COPY server/ ./server/

RUN npm run build --workspace=server


FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm ci --workspace=server --omit=dev --ignore-scripts

COPY --from=builder /app/server/dist ./server/dist

# SQL files must live beside migrate.js (reads via import.meta.url)
COPY server/src/db/schema.sql ./server/dist/db/schema.sql
COPY server/src/db/agent-schema.sql ./server/dist/db/agent-schema.sql

# UPLOADS_DIR resolves to client/public/uploads relative to server/dist
RUN mkdir -p ./client/public/uploads

COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
