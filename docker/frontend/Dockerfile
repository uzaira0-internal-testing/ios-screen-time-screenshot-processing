# =============================================================================
# Frontend Dockerfile - ios-screen-time-screenshot-processing
# =============================================================================
# Multi-stage build: Bun for building, Nginx for serving
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS build

# Install Python and build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Build argument for API path (set by docker-compose)
ARG APP_PATH_PREFIX=/screenshot
ENV VITE_API_BASE_URL=${APP_PATH_PREFIX}/api/v1
ENV VITE_BASE_PATH=${APP_PATH_PREFIX}

# Copy package files (paths relative to monorepo root context)
COPY apps/ios-screen-time-screenshot-processing/frontend/package.json apps/ios-screen-time-screenshot-processing/frontend/bun.lock* apps/ios-screen-time-screenshot-processing/frontend/package-lock.json* ./

# Install dependencies
RUN bun install

# Copy source
COPY apps/ios-screen-time-screenshot-processing/frontend/ ./

# Build for production
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 2: Serve with Nginx
# -----------------------------------------------------------------------------
FROM nginx:alpine AS production

# Install curl for healthcheck (wget has issues with localhost in Alpine)
RUN apk add --no-cache curl

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config (path relative to monorepo root context)
COPY apps/ios-screen-time-screenshot-processing/docker/nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
