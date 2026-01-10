# Security Review - Screenshot Annotator

**Review Date:** 2025-12-10  
**Reviewer:** Claude Code  
**Overall Security Posture:** MODERATE RISK - Acceptable for internal research tool, not suitable for public deployment

---

## Executive Summary

This application is designed as an internal research tool with intentionally simple authentication. The security model prioritizes ease of use for trusted users over robust protection against malicious actors. This is acceptable given the stated use case but means the application should remain on internal networks only.

**Critical Issues:** 1  
**High Priority:** 3  
**Medium Priority:** 4  
**Low Priority:** 2

---

## Critical Issues (Must Fix Immediately)

### 1. Path Traversal in File Serving (CRITICAL)

**Location:** `src/screenshot_processor/web/api/routes/screenshots.py:726-739`

```python
@router.get("/{screenshot_id}/image")
async def get_screenshot_image(screenshot_id: int, db: DatabaseSession):
    result = await db.execute(select(Screenshot).where(Screenshot.id == screenshot_id))
    screenshot = result.scalar_one_or_none()
    # ...
    file_path = Path(screenshot.file_path)
    if not file_path.exists():
        raise HTTPException(...)
    return FileResponse(file_path, media_type=media_type)
```

**Risk:** If `file_path` in the database is maliciously modified (e.g., via SQL injection or admin compromise), arbitrary files could be served.

**Recommendation:**
```python
@router.get("/{screenshot_id}/image")
async def get_screenshot_image(screenshot_id: int, db: DatabaseSession):
    # ... get screenshot ...
    settings = get_settings()
    upload_dir = Path(settings.UPLOAD_DIR).resolve()
    file_path = Path(screenshot.file_path).resolve()
    
    # Ensure file is within upload directory
    if not str(file_path).startswith(str(upload_dir)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not file_path.exists():
        raise HTTPException(...)
    return FileResponse(file_path, media_type=media_type)
```

---

## High Priority Issues (Fix Soon)

### 2. Header-Based Authentication Without Validation

**Location:** `src/screenshot_processor/web/api/dependencies.py:12-28`

```python
async def get_current_user(
    x_username: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    if not x_username:
        raise HTTPException(status_code=401, detail="Username header required")
    
    # Auto-creates user if doesn't exist
    result = await db.execute(select(User).where(User.username == x_username))
    user = result.scalar_one_or_none()
    
    if not user:
        role = "admin" if x_username.lower() == "admin" else "annotator"
        user = User(username=x_username, role=role, is_active=True)
        # ...
```

**Risk:** 
- Anyone can impersonate any user by setting the `X-Username` header
- Anyone can gain admin access by using `X-Username: admin`
- No password, token, or any verification

**Recommendation:** This is intentional for the internal research tool use case, but document it clearly:
- Add a warning banner in the UI
- Restrict to internal network via firewall/VPN
- For any external exposure, implement proper authentication (JWT, OAuth)

### 3. Admin Auto-Grant on Username "admin"

**Location:** `src/screenshot_processor/web/api/dependencies.py:23`

```python
role = "admin" if x_username.lower() == "admin" else "annotator"
```

**Risk:** Any user can become admin by logging in with username "admin".

**Recommendation:**
```python
# Remove auto-admin grant, require explicit admin setup
role = "annotator"  # Always default to annotator

# Add a separate admin setup process or configuration
```

### 4. Rate Limiting May Be Insufficient

**Location:** `src/screenshot_processor/web/api/main.py` (check for slowapi configuration)

**Risk:** Without proper rate limiting, the API is vulnerable to:
- Brute force attacks (though auth is weak anyway)
- DoS attacks
- Abuse of expensive OCR/processing endpoints

**Recommendation:** Ensure rate limiting is configured per-user and per-IP:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/upload")
@limiter.limit("10/minute")  # Example: 10 uploads per minute per IP
async def upload_screenshot(...):
    ...
```

---

## Medium Priority Issues

### 5. Secrets in Default Values

**Location:** `src/screenshot_processor/web/config.py:16-17`

```python
SECRET_KEY: str = Field(
    default="dev-secret-key-change-in-production-min-32-chars-long",
    ...
)
```

**Risk:** If `.env` is not properly configured, defaults may be used in production.

**Status:** Partially mitigated by validation at line 64-73, but the default still exists.

**Recommendation:** Remove default entirely and fail startup if not set:
```python
SECRET_KEY: str = Field(
    ...,  # Required, no default
    description="Secret key for JWT token signing. MUST be set.",
)
```

### 6. API Key in Query Parameter History (Now Fixed)

**Location:** Upload endpoint now uses header (`X-API-Key`)

**Status:** FIXED - API key is now passed via header, not query parameter. Good practice.

### 7. No Input Sanitization on Filename

**Location:** `src/screenshot_processor/web/api/routes/screenshots.py:858`

```python
if request.filename:
    base_name = Path(request.filename).stem
    filename = f"{request.group_id}/{request.participant_id}/{base_name}_{file_hash}{extension}"
```

**Risk:** While `Path.stem` provides some sanitization, malicious filenames could still cause issues.

**Recommendation:**
```python
import re

def sanitize_filename(name: str) -> str:
    # Remove any path components and dangerous characters
    name = Path(name).stem
    return re.sub(r'[^\w\-.]', '_', name)[:100]

base_name = sanitize_filename(request.filename)
```

### 8. CORS Origins from Environment Without Validation

**Location:** `src/screenshot_processor/web/config.py:42-49`

```python
CORS_ORIGINS: str = Field(
    default="http://localhost:3000,http://localhost:5173",
    ...
)
```

**Risk:** If misconfigured (e.g., `*` or overly broad origins), cross-origin attacks possible.

**Recommendation:** Add validation to reject wildcard and validate URL format:
```python
@field_validator("CORS_ORIGINS")
@classmethod
def validate_cors_origins(cls, v: str) -> list[str]:
    origins = [o.strip() for o in v.split(",")]
    if "*" in origins:
        raise ValueError("Wildcard CORS origin not allowed")
    for origin in origins:
        if not origin.startswith(("http://", "https://")):
            raise ValueError(f"Invalid origin format: {origin}")
    return origins
```

---

## Low Priority Issues

### 9. Debug Images Could Leak Information

**Location:** `src/screenshot_processor/web/config.py:28`

```python
SAVE_DEBUG_IMAGES: bool = Field(default=False, ...)
```

**Status:** Default is False, which is good.

**Recommendation:** Ensure debug directory is not web-accessible and is cleaned up periodically.

### 10. Username Stored in localStorage

**Location:** `frontend/src/services/apiClient.ts:16`

```typescript
const username = localStorage.getItem("username");
```

**Risk:** Username visible in browser developer tools, persists after logout if not cleared.

**Status:** Acceptable for internal tool, but not for public-facing app.

---

## SQL Injection Analysis

**Status:** SECURE

All database queries use SQLAlchemy ORM with parameterized queries:
- `select(User).where(User.username == x_username)` - Safe
- `select(Screenshot).where(Screenshot.id == screenshot_id)` - Safe
- All queries use bound parameters

No raw SQL concatenation found.

---

## Dependency Analysis

Run `pip-audit` or `safety check` to identify known vulnerabilities in dependencies. Key dependencies to monitor:
- FastAPI, Starlette (web framework)
- SQLAlchemy (database)
- Pillow, OpenCV (image processing)
- Tesseract bindings (OCR)

---

## Recommendations Summary

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| Critical | Path traversal in file serving | Low | High |
| High | Document auth limitations | Low | Medium |
| High | Remove admin auto-grant | Low | High |
| High | Add/verify rate limiting | Medium | Medium |
| Medium | Remove secret defaults | Low | Medium |
| Medium | Sanitize filenames | Low | Low |
| Medium | Validate CORS origins | Low | Medium |

---

## Conclusion

The application is suitable for its stated purpose as an internal research tool on a trusted network. Before any external exposure, critical and high-priority issues must be addressed, and proper authentication should be implemented.
