from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi_errors import setup_error_handlers
from fastapi_logging import RequestLoggingMiddleware, get_logger, setup_logging
from fastapi_ratelimit import setup_rate_limiting
from global_auth import SessionAuthMiddleware, create_session_auth_router
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth_setup import create_session_storage
from ..config import get_settings
from ..database import HealthCheckResponse, RootResponse, get_db, init_db
from . import v1

# Get settings for rate limiting configuration
settings = get_settings()

# Configure structured logging (JSON in production, text in development)
setup_logging(json_format=not settings.DEBUG)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting iOS Screenshot Processing API...")
    await init_db()
    logger.info("Database initialized")
    yield
    logger.info("Shutting down iOS Screenshot Processing API...")


app = FastAPI(
    title="iOS Screenshot Processing API",
    description="Multi-user platform for processing iPhone screen time and battery screenshots",
    version="1.0.0",
    lifespan=lifespan,
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
)

# Setup standardized error handlers (replaces custom exception handler)
setup_error_handlers(app, debug=settings.DEBUG)
logger.info("Error handlers configured")

# Setup rate limiting (replaces slowapi)
setup_rate_limiting(app, default_limits=[settings.RATE_LIMIT_DEFAULT])
logger.info("Rate limiting configured", default_limits=[settings.RATE_LIMIT_DEFAULT])

# Add request logging middleware
app.add_middleware(RequestLoggingMiddleware)

# Get CORS origins from config
cors_origins = settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else [settings.CORS_ORIGINS]

# Configure CORS - must be before SessionAuthMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Username", "X-Site-Password"],
)

# Create session storage for authentication
session_storage = create_session_storage()

# Add session auth middleware - BLOCKS ALL requests without valid session
# except for allowlisted paths (login, status, health, docs)
app.add_middleware(
    SessionAuthMiddleware,
    get_settings=get_settings,
    session_storage=session_storage,
    allowed_paths=[
        "/api/v1/auth/status",
        "/api/v1/auth/session/login",
        "/api/v1/auth/login",  # Header-based auth for API clients
        "/health",
        "/",
        "/api/v1/docs",
        "/api/v1/redoc",
        "/api/v1/openapi.json",
    ],
)


@app.get("/", response_model=RootResponse)
async def root():
    """Root endpoint providing API information."""
    return RootResponse(
        message="Screenshot Annotation API",
        version="1.0.0",
        docs="/api/v1/docs",
        redoc="/api/v1/redoc",
    )


@app.get("/health", response_model=HealthCheckResponse)
async def health_check(db: AsyncSession = Depends(get_db), include_celery: bool = False):
    """
    Comprehensive health check endpoint.

    Returns health status including database connectivity.
    Set include_celery=true to also check Celery worker availability.
    """
    health_status = "healthy"
    checks_dict = {}

    # Database connectivity check
    try:
        await db.execute(text("SELECT 1"))
        checks_dict["database"] = "ok"
    except Exception as e:
        logger.error(f"Health check - database error: {e}")
        health_status = "unhealthy"
        checks_dict["database"] = f"error: {str(e)}"

    # Optional Celery health check
    if include_celery:
        try:
            from screenshot_processor.web.celery_app import celery_app

            # Ping Celery workers with short timeout
            inspect = celery_app.control.inspect(timeout=2.0)
            active_workers = inspect.active()
            if active_workers:
                checks_dict["celery"] = f"ok ({len(active_workers)} workers)"
            else:
                checks_dict["celery"] = "no workers available"
                # Don't mark unhealthy - Celery may be optional
        except Exception as e:
            logger.warning(f"Health check - celery error: {e}")
            checks_dict["celery"] = f"error: {str(e)}"

    # Return appropriate status code
    status_code = 200 if health_status == "healthy" else 503
    return JSONResponse(
        content=HealthCheckResponse(status=health_status, checks=checks_dict).model_dump(),
        status_code=status_code,
    )


# Mount v1 API
app.include_router(v1.router, prefix="/api")

# Session-based auth router - provides login/logout/status endpoints
# Uses the same session_storage as the middleware
auth_router = create_session_auth_router(
    get_settings=get_settings,
    session_storage=session_storage,
    prefix="",
    tags=["auth"],
)
app.include_router(auth_router, prefix="/api/v1/auth")
