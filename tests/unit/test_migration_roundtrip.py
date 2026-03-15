"""
Test that Alembic migrations are reversible.

Verifies: upgrade head → downgrade base → upgrade head (idempotency).
Requires a real PostgreSQL database. Uses a temporary database created from
the existing connection to avoid touching production data.

Skipped if DATABASE_URL points to SQLite or is unset.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(
    "postgresql" not in os.environ.get("DATABASE_URL", ""),
    reason="Migration roundtrip requires PostgreSQL",
)


@pytest.fixture()
def _empty_migration_db():
    """Create a temporary database for migration testing, drop it after."""
    import psycopg2
    from urllib.parse import urlparse

    db_url = os.environ["DATABASE_URL"]
    parsed = urlparse(db_url.replace("+asyncpg", ""))
    base_dsn = f"postgresql://{parsed.username}:{parsed.password}@{parsed.hostname}:{parsed.port or 5432}/postgres"
    test_db = "migration_roundtrip_test"

    conn = psycopg2.connect(base_dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(f"DROP DATABASE IF EXISTS {test_db}")
    cur.execute(f"CREATE DATABASE {test_db}")
    cur.close()
    conn.close()

    test_url = f"postgresql+asyncpg://{parsed.username}:{parsed.password}@{parsed.hostname}:{parsed.port or 5432}/{test_db}"
    old_url = os.environ["DATABASE_URL"]
    os.environ["DATABASE_URL"] = test_url
    yield
    os.environ["DATABASE_URL"] = old_url

    conn = psycopg2.connect(base_dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(f"DROP DATABASE IF EXISTS {test_db}")
    cur.close()
    conn.close()


def test_migration_roundtrip(_empty_migration_db):
    """Upgrade → downgrade → upgrade must not fail on an empty database."""
    from alembic.config import Config
    from alembic.command import upgrade, downgrade

    alembic_cfg = Config("alembic.ini")

    upgrade(alembic_cfg, "head")
    downgrade(alembic_cfg, "base")
    upgrade(alembic_cfg, "head")
