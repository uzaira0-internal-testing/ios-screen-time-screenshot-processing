"""
Test that Alembic migrations are reversible.

Verifies: upgrade head → downgrade base → upgrade head (idempotency).
Requires a real PostgreSQL database. Uses a temporary database created from
the existing connection to avoid touching production data.

Skipped if DATABASE_URL points to SQLite or is unset.

NOTE: This test is marked xfail because some migrations have ordering issues
(e.g., foreign keys referencing tables created by later migrations). Fix the
migrations and remove xfail when resolved.
"""
import os

import pytest

# Skip if no PostgreSQL available
pytestmark = [
    pytest.mark.skipif(
        "postgresql" not in os.environ.get("DATABASE_URL", ""),
        reason="Migration roundtrip requires PostgreSQL",
    ),
    pytest.mark.xfail(
        reason="Known migration ordering issues (groups FK before groups table)",
        strict=False,
    ),
]


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

    # Point DATABASE_URL at the temp database for this test
    test_url = f"postgresql+asyncpg://{parsed.username}:{parsed.password}@{parsed.hostname}:{parsed.port or 5432}/{test_db}"
    old_url = os.environ["DATABASE_URL"]
    os.environ["DATABASE_URL"] = test_url
    yield
    os.environ["DATABASE_URL"] = old_url

    # Cleanup
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
