"""
Test that Alembic migrations are reversible.

Verifies: upgrade head -> downgrade base -> upgrade head (idempotency).
Requires a real PostgreSQL database (skipped if DATABASE_URL is SQLite).
"""
import os
import pytest

# Skip entirely if alembic is not installed or DATABASE_URL is SQLite/missing
pytestmark = pytest.mark.skipif(
    "sqlite" in os.environ.get("DATABASE_URL", "sqlite"),
    reason="Migration roundtrip requires PostgreSQL (not SQLite)",
)


def test_migration_roundtrip():
    """Upgrade -> downgrade -> upgrade must not fail."""
    from alembic.config import Config
    from alembic.command import upgrade, downgrade

    alembic_cfg = Config("alembic.ini")

    # Upgrade to latest
    upgrade(alembic_cfg, "head")

    # Downgrade to base
    downgrade(alembic_cfg, "base")

    # Re-upgrade to latest (must be idempotent)
    upgrade(alembic_cfg, "head")
