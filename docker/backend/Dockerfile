# =============================================================================
# Backend Dockerfile - ios-screen-time-screenshot-processing
# =============================================================================
# Python 3.12 with FastAPI, Tesseract OCR, and async PostgreSQL support
#
# Build context: monorepo root (../../..)
# docker build -f apps/ios-screen-time-screenshot-processing/docker/backend/Dockerfile .

FROM python:3.12-slim

# Install system dependencies including Tesseract OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install uv for faster package installation
RUN pip install --no-cache-dir uv

# Copy shared monorepo packages first (for layer caching)
COPY packages/global-pass-honor-username-auth /app/packages/global-pass-honor-username-auth
COPY packages/fastapi-errors /app/packages/fastapi-errors
COPY packages/fastapi-logging /app/packages/fastapi-logging
COPY packages/fastapi-ratelimit /app/packages/fastapi-ratelimit
COPY packages/db-toolkit /app/packages/db-toolkit
COPY packages/fastapi-pagination /app/packages/fastapi-pagination
COPY packages/fastapi-files /app/packages/fastapi-files
COPY packages/fastapi-tasks /app/packages/fastapi-tasks

# Copy app dependency files
COPY apps/ios-screen-time-screenshot-processing/pyproject.toml ./

# Create minimal src structure needed for editable install
RUN mkdir -p src/screenshot_processor && \
    touch src/screenshot_processor/__init__.py

# Install shared packages by path (before app dependencies)
RUN uv pip install --system --no-cache-dir \
    /app/packages/global-pass-honor-username-auth \
    /app/packages/fastapi-errors \
    /app/packages/fastapi-logging \
    /app/packages/fastapi-ratelimit \
    /app/packages/db-toolkit \
    /app/packages/fastapi-pagination \
    /app/packages/fastapi-files \
    /app/packages/fastapi-tasks

# Install app dependencies (cached unless pyproject.toml changes)
RUN uv pip install --system --no-cache-dir -e ".[web,preprocessing]" alembic

# Copy application source code
COPY apps/ios-screen-time-screenshot-processing/src/ ./src/
COPY apps/ios-screen-time-screenshot-processing/alembic/ ./alembic/
COPY apps/ios-screen-time-screenshot-processing/alembic.ini ./

# Create necessary directories
RUN mkdir -p /app/db /app/output /app/debug /app/uploads

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Copy and set up entrypoint script
COPY apps/ios-screen-time-screenshot-processing/docker/backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default command - entrypoint handles migrations automatically
CMD ["/entrypoint.sh"]
