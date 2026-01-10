# Error Handling Review - Screenshot Annotator

**Review Date:** 2025-12-10  
**Reviewer:** Claude Code  
**Overall Error Handling:** MODERATE - Good patterns exist but inconsistently applied

---

## Critical Gaps

### 1. Silent Data Loss on Celery Task Failure

**Location:** `src/screenshot_processor/web/tasks.py:52-90`

```python
except Exception as e:
    db.rollback()
    logger.error(f"Error processing screenshot {screenshot_id}: {e}")
    
    try:
        self.retry(exc=e)
    except self.MaxRetriesExceededError:
        # Mark as failed after max retries
        screenshot.processing_status = ProcessingStatus.FAILED
        # But no notification to user!
```

**Issue:** When processing fails after max retries:
- Screenshot marked as FAILED silently
- No WebSocket notification sent
- User may not know to check or retry

**Fix:**
```python
except self.MaxRetriesExceededError:
    if screenshot:
        screenshot.processing_status = ProcessingStatus.FAILED
        screenshot.processing_issues = [...]
        db.commit()
        
        # Notify via WebSocket
        from screenshot_processor.web.websocket import broadcast_event
        await broadcast_event({
            "type": "processing_failed",
            "screenshot_id": screenshot_id,
            "error": str(e),
            "max_retries_exceeded": True
        })
```

### 2. Swallowed Exceptions in Store Actions

**Location:** `frontend/src/store/createAnnotationStore.ts`

Some errors are swallowed silently:

```typescript
loadConsensus: async (screenshotId: number) => {
  try {
    const consensus = await consensusService.getForScreenshot(screenshotId);
    set({ consensus });
  } catch (error) {
    console.error("Failed to load consensus:", error);
    // Error swallowed - user never knows
  }
}
```

vs. others throw:

```typescript
submitAnnotation: async (notes?: string) => {
  // ... 
  throw error;  // Propagates to caller
}
```

**Fix - Consistent Pattern:**
```typescript
// Non-critical operations: log and set null
loadConsensus: async (screenshotId: number) => {
  try {
    const consensus = await consensusService.getForScreenshot(screenshotId);
    set({ consensus });
  } catch (error) {
    console.warn("[loadConsensus] Non-critical failure:", error);
    set({ consensus: null, consensusError: "Failed to load" });
  }
}

// Critical operations: always propagate
submitAnnotation: async (notes?: string) => {
  try { ... }
  catch (error) {
    set({ error: message });
    throw error;  // Let caller decide how to handle
  }
}
```

### 3. Database Errors Not Properly Handled

**Location:** `src/screenshot_processor/web/api/routes/screenshots.py`

Many endpoints have this pattern:

```python
try:
    # ... database operations ...
    await db.commit()
except Exception as e:
    await db.rollback()
    logger.error(f"Failed: {e}")
    raise HTTPException(status_code=500, detail="Failed to ...")
```

**Issue:** The original exception `e` is lost in the HTTPException, making debugging harder.

**Fix:**
```python
except Exception as e:
    await db.rollback()
    logger.exception(f"Database error in endpoint X")  # Logs full traceback
    
    # In dev, include details; in prod, generic message
    if settings.DEBUG:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    else:
        raise HTTPException(status_code=500, detail="Internal server error")
```

---

## High Priority Issues

### 4. Missing Error Boundaries in Frontend

**Location:** Frontend React components

**Issue:** No React error boundaries exist. A crash in one component crashes the entire app.

**Fix - Add Error Boundary:**
```typescript
// components/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    // Could send to error tracking service
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 bg-red-50 text-red-700 rounded">
          <h2>Something went wrong</h2>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 5. Inconsistent Error Response Formats

**Location:** Various API endpoints

Some endpoints return:
```json
{"detail": "Error message"}
```

Others return:
```json
{"error": "Error message"}
```

Or even:
```json
{"success": false, "message": "Error message"}
```

**Fix - Standardize Error Response:**
```python
# schemas.py
class ErrorResponse(BaseModel):
    detail: str
    code: str | None = None
    context: dict | None = None

# All endpoints use:
raise HTTPException(
    status_code=400,
    detail=ErrorResponse(
        detail="Screenshot not found",
        code="NOT_FOUND",
        context={"screenshot_id": screenshot_id}
    ).model_dump()
)
```

### 6. No Timeout Handling for OCR

**Location:** `src/screenshot_processor/core/ocr.py` (assumed)

**Issue:** OCR operations can hang indefinitely on malformed images.

**Fix:**
```python
import signal
from contextlib import contextmanager

@contextmanager
def timeout(seconds: int):
    def handler(signum, frame):
        raise TimeoutError(f"OCR operation timed out after {seconds}s")
    
    signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)

def find_screenshot_title(img):
    try:
        with timeout(30):  # 30 second max for OCR
            # ... OCR operations ...
    except TimeoutError as e:
        logger.warning(f"OCR timeout: {e}")
        return None, None
```

---

## Medium Priority Issues

### 7. Missing Logging Context

**Location:** Throughout codebase

```python
logger.error(f"Error processing screenshot {file_path}: {e}")
```

**Issue:** Missing request context, user info, timing data.

**Fix - Structured Logging:**
```python
import structlog

logger = structlog.get_logger()

logger.error(
    "Screenshot processing failed",
    screenshot_id=screenshot_id,
    file_path=file_path,
    error_type=type(e).__name__,
    error_message=str(e),
    user_id=current_user.id if current_user else None,
    processing_time_ms=elapsed_ms,
)
```

### 8. Frontend Retry Logic Gaps

**Location:** `frontend/src/hooks/useAnnotationWithDI.ts`

Only some actions have retry toast:

```typescript
// Has retry:
toastErrorWithRetry({
  message: errorMessage,
  onRetry: () => handleSubmit(notes),
  retryLabel: "Retry Submit",
});

// No retry for:
const handleReprocessWithGrid = useCallback(async (coords) => {
  try {
    await storeReprocessWithGrid(coords);
  } catch (err: any) {
    throw err;  // Just thrown, no retry offered
  }
}, [...]);
```

**Fix:** Add retry to all user-initiated actions:
```typescript
const handleReprocessWithGrid = useCallback(async (coords: GridCoordinates) => {
  try {
    await storeReprocessWithGrid(coords);
  } catch (err: any) {
    const message = err.message || "Failed to reprocess";
    toastErrorWithRetry({
      message,
      onRetry: () => handleReprocessWithGrid(coords),
      retryLabel: "Retry Processing",
    });
    throw err;
  }
}, [storeReprocessWithGrid]);
```

### 9. No Graceful Degradation for WebSocket

**Location:** Frontend WebSocket handling (assumed)

**Issue:** If WebSocket disconnects, real-time features silently stop working.

**Fix:**
```typescript
// websocket.ts
class WebSocketManager {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  private onClose = () => {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      toast.warning(`Connection lost. Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
    } else {
      toast.error("Connection lost. Please refresh the page.");
    }
  };
}
```

### 10. Celery Task Doesn't Validate Input

**Location:** `src/screenshot_processor/web/tasks.py:46-50`

```python
@celery_app.task(bind=True, max_retries=3)
def process_screenshot_task(self, screenshot_id: int):
    screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
    
    if not screenshot:
        return {"success": False, "error": "Screenshot not found"}
        # Silently returns - no retry, no logging of who queued invalid ID
```

**Fix:**
```python
@celery_app.task(bind=True, max_retries=3)
def process_screenshot_task(self, screenshot_id: int):
    if not isinstance(screenshot_id, int) or screenshot_id <= 0:
        logger.error(f"Invalid screenshot_id: {screenshot_id}")
        return {"success": False, "error": "Invalid screenshot ID"}
    
    screenshot = db.query(Screenshot).filter(Screenshot.id == screenshot_id).first()
    
    if not screenshot:
        logger.warning(f"Screenshot {screenshot_id} not found - may have been deleted")
        return {"success": False, "error": "Screenshot not found", "deleted": True}
```

---

## Low Priority Issues

### 11. Bare `except:` Clauses

**Location:** `src/screenshot_processor/web/services/processing_service.py:195`

```python
except Exception as e:
    # Catches everything including KeyboardInterrupt, SystemExit
```

**Fix:**
```python
except (cv2.error, IOError, ValueError) as e:
    # Handle expected errors
except Exception as e:
    logger.exception("Unexpected error")
    raise  # Re-raise unexpected errors
```

### 12. Missing Cleanup on Error

**Location:** Image processing functions

```python
def process_image(...):
    img = cv2.imread(file_path)
    # ... processing ...
    # If error occurs, temporary files may be left behind
```

**Fix:**
```python
def process_image(...):
    temp_files = []
    try:
        img = cv2.imread(file_path)
        # ... processing that creates temp files ...
        temp_files.append(temp_path)
        # ...
    finally:
        for temp in temp_files:
            try:
                temp.unlink(missing_ok=True)
            except Exception:
                pass
```

---

## Logging Recommendations

### Current State

- Basic Python logging configured
- Log levels used inconsistently
- No structured logging

### Recommended Improvements

1. **Add request ID to all logs:**
```python
# middleware.py
from uuid import uuid4

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response
```

2. **Log at appropriate levels:**
```
DEBUG: Detailed processing steps, variable values
INFO: Request start/end, major operations completed
WARNING: Recoverable issues, retries, fallbacks
ERROR: Failures that need attention
CRITICAL: System-level failures
```

3. **Include timing data:**
```python
import time

start = time.time()
# ... operation ...
elapsed = time.time() - start
logger.info(f"Operation completed", extra={"duration_ms": elapsed * 1000})
```

---

## Summary - Priority Fixes

| Issue | Severity | Effort | Fix |
|-------|----------|--------|-----|
| Silent Celery failures | Critical | Medium | Add WebSocket notification |
| Swallowed exceptions in store | High | Low | Consistent error pattern |
| Missing error boundaries | High | Low | Add React ErrorBoundary |
| Inconsistent error formats | Medium | Low | Standardize ErrorResponse |
| No OCR timeout | Medium | Low | Add signal timeout |
| Missing retry on reprocess | Medium | Low | Add toastErrorWithRetry |
| Bare except clauses | Low | Low | Be specific about exceptions |

---

## Conclusion

The error handling has good foundations but needs:
1. **Consistency** - Same pattern across all error types
2. **Visibility** - Errors must be surfaced to users appropriately
3. **Context** - Logs need more debugging information
4. **Recovery** - More retry options for user-initiated actions

Priority should be given to preventing silent data loss and ensuring users know when operations fail.
