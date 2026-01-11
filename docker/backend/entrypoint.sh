#!/bin/bash
set -e

echo "=== Backend Startup ==="

# Convert async URL to sync for alembic
export SYNC_DATABASE_URL="${DATABASE_URL//+asyncpg/+psycopg2}"

# Check if database has tables but no alembic version (existing DB without migrations)
NEEDS_STAMP=$(python -c "
from sqlalchemy import create_engine, text
import os

engine = create_engine(os.environ['SYNC_DATABASE_URL'])
with engine.connect() as conn:
    # Check if users table exists
    has_tables = conn.execute(text(
        \"SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='users')\"
    )).scalar()

    # Check if alembic_version has any rows
    try:
        has_version = conn.execute(text('SELECT COUNT(*) FROM alembic_version')).scalar() > 0
    except:
        has_version = False

    # Need stamp if tables exist but no alembic version
    print('true' if has_tables and not has_version else 'false')
")

if [ "$NEEDS_STAMP" = "true" ]; then
    echo "Existing database detected without alembic version - stamping to head"
    alembic stamp head
fi

echo "Running database migrations..."
alembic upgrade head

echo "Starting uvicorn..."
exec uvicorn src.screenshot_processor.web.api.main:app --host 0.0.0.0 --port 8000
