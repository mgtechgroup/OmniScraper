FROM node:18-alpine AS base
RUN addgroup -S omniscraper && adduser -S omniscraper -G omniscraper
WORKDIR /app
RUN apk add --no-cache dumb-init

FROM base AS builder
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .

FROM base AS production
COPY --from=builder /app /app
RUN chown -R omniscraper:omniscraper /app
USER omniscraper
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
