"""
Celery application for background task processing.

This module configures Celery with Redis as the message broker and result backend.
Tasks are defined for screenshot processing (OCR, grid detection, etc.)
"""

import logging
import os

from celery import Celery

logger = logging.getLogger(__name__)

# Get Redis URL from environment
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

# Create Celery app
celery_app = Celery(
    "screenshot_processor",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=["screenshot_processor.web.tasks"],
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Task execution settings
    task_acks_late=True,  # Acknowledge task after completion (reliability)
    task_reject_on_worker_lost=True,  # Requeue if worker dies
    # Rate limiting - high limit since upload speed is the priority
    task_default_rate_limit="50/s",
    # Result expiration (1 hour)
    result_expires=3600,
    # Worker settings
    worker_prefetch_multiplier=2,  # Prefetch 2 tasks per worker for better throughput
    worker_concurrency=8,  # Number of concurrent workers
)
