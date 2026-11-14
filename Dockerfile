# syntax=docker/dockerfile:1

# Stage 1: Build frontend and bundle server
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server-dist ./server-dist
COPY --from=builder /app/db ./db

# Run as non-root node user for defense-in-depth
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server-dist/server.cjs"]
