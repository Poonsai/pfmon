FROM node:20-alpine AS builder
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

RUN apk add --no-cache curl ca-certificates \
 && node scripts/fetch-data.js \
 && apk del curl

FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S pfmon && adduser -S pfmon -G pfmon \
 && mkdir -p /data && chown pfmon:pfmon /data

COPY --from=builder --chown=pfmon:pfmon /build/node_modules ./node_modules
COPY --from=builder --chown=pfmon:pfmon /build/src ./src
COPY --from=builder --chown=pfmon:pfmon /build/scripts ./scripts
COPY --from=builder --chown=pfmon:pfmon /build/data ./data
COPY --chown=pfmon:pfmon package.json ./

USER pfmon
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/api/health || exit 1

CMD ["node", "src/index.js"]
