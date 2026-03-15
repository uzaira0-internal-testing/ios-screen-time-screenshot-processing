"""
API fuzz testing using Schemathesis.

Generates random valid/invalid requests based on the OpenAPI schema
and verifies the API handles them without crashing (no 500s).

Requires the backend to be running. Skips if schemathesis not installed.
"""
import pytest

try:
    import schemathesis

    HAS_SCHEMATHESIS = True
except ImportError:
    HAS_SCHEMATHESIS = False

pytestmark = pytest.mark.skipif(not HAS_SCHEMATHESIS, reason="schemathesis not installed")

# Load schema from the running app
# In tests, use the ASGI app directly (no network needed)
if HAS_SCHEMATHESIS:
    try:
        import os

        os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-chars-long-for-testing")
        os.environ.pop("SITE_PASSWORD", None)
        from screenshot_processor.web.api.main import app

        schema = schemathesis.from_asgi("/openapi.json", app=app)
    except Exception:
        schema = None
else:
    schema = None


if schema is not None:

    @schema.parametrize()
    def test_api_does_not_crash(case):
        """Every API endpoint should handle any valid schema input without 500."""
        # Add auth header since all endpoints require it
        case.headers = case.headers or {}
        case.headers["X-Username"] = "fuzz-tester"

        response = case.call_asgi()
        case.validate_response(response)
        # No 500 errors allowed
        assert response.status_code < 500, (
            f"{case.method} {case.path} returned {response.status_code}: {response.text[:200]}"
        )
