FROM node:20-alpine
RUN apk add --no-cache dumb-init curl
RUN addgroup -S omniscraper && adduser -S omniscraper -G omniscraper
WORKDIR /app
COPY node_modules ./node_modules
COPY src ./src
COPY .env.example ./.env.example
RUN chown -R omniscraper:omniscraper /app && mkdir -p /app/logs && chown omniscraper:omniscraper /app/logs
USER omniscraper
ENV NODE_ENV=production PORT=3000 LOG_LEVEL=info
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
