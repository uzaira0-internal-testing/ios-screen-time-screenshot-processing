# Proposed Solutions for All Identified Issues

**Date:** 2025-12-18

---

## Part 1: Critical Bug Fixes

### 1.1 SQLAlchemy Boolean Comparison Bugs

**Problem:** Using `is True`/`is False` instead of `== True`/`== False`

**Solution:** Replace all instances with proper SQLAlchemy equality operators.

```python
# screenshots.py line 298
# BEFORE:
consensus_stmt = select(func.count(ConsensusResult.id)).where(ConsensusResult.has_consensus is True)
# AFTER:
consensus_stmt = select(func.count(ConsensusResult.id)).where(ConsensusResult.has_consensus == True)  # noqa: E712

# screenshots.py line 302
# BEFORE:
disagreements_stmt = select(func.count(ConsensusResult.id)).where(ConsensusResult.has_consensus is False)
# AFTER:
disagreements_stmt = select(func.count(ConsensusResult.id)).where(ConsensusResult.has_consensus == False)  # noqa: E712

# screenshots.py line 306
# BEFORE:
users_active_stmt = select(func.count(User.id)).where(User.is_active is True)
# AFTER:
users_active_stmt = select(func.count(User.id)).where(User.is_active == True)  # noqa: E712

# consensus_service.py line 178
# BEFORE:
total_with_consensus_stmt = select(func.count(ConsensusResult.id)).where(ConsensusResult.has_consensus is True)
# AFTER:
total_with_consensus_stmt = select(func.count(ConsensusResult.id)).where(ConsensusResult.has_consensus == True)  # noqa: E712

# consensus_service.py line 183
# BEFORE:
total_with_disagreements_stmt = select(func.count(ConsensusResult.id)).where(
    ConsensusResult.has_consensus is False
)
# AFTER:
total_with_disagreements_stmt = select(func.count(ConsensusResult.id)).where(
    ConsensusResult.has_consensus == False  # noqa: E712
)
```

---

### 1.2 Consensus Schema Mismatch

**Problem:** Service returns `consensus_value`, API expects `median`

**Solution A (Recommended):** Update service to include both field names for backward compatibility:

```python
# consensus_service.py lines 119-129
disagreements.append({
    "hour": hour,
    "values": values,
    "consensus_value": consensus_value,
    "median": consensus_value,  # ADD: Alias for backward compatibility
    "has_disagreement": True,
    "max_difference": max_diff,
    "severity": severity.value,
    "strategy_used": strategy.value,
})
```

**Solution B (Cleaner):** Update API to use correct field name:

```python
# consensus.py line 386
# BEFORE:
DisagreementDetail(
    hour=d["hour"],
    values=d["values"],
    median=d["median"],  # KeyError!
    ...
)
# AFTER:
DisagreementDetail(
    hour=d["hour"],
    values=d["values"],
    median=d.get("consensus_value", d.get("median", 0)),  # Handle both
    ...
)
```

---

### 1.3 Grid Detection Silent Failure (WASM)

**Problem:** Returns "complete" with empty data when grid detection fails

**Solution:** Return explicit error response:

```typescript
// imageProcessor.worker.ts lines 327-345
if (!detectedGrid) {
  // BEFORE: Silent partial success
  // AFTER: Explicit error
  const response: WorkerResponse = {
    type: "PROCESS_IMAGE_ERROR",  // Changed from COMPLETE
    id,
    error: "Grid detection failed: Could not locate graph boundaries. Please manually select the grid area.",
    payload: {
      // Include partial data user might want
      title,
      total,
      // Explicitly indicate grid failed
      gridDetectionFailed: true,
    },
  };
  self.postMessage(response);
  return;
}
```

**Frontend handling:**

```typescript
// In the calling code (WASMProcessingService.ts)
case "PROCESS_IMAGE_ERROR":
  if (response.payload?.gridDetectionFailed) {
    // Show specific UI for manual grid selection
    toast.error("Automatic grid detection failed. Please draw the grid manually.");
    // Enable manual grid mode
    setManualGridMode(true);
  }
  break;
```

---

### 1.4 Race Condition in Annotation Count

**Problem:** `current_annotation_count += 1` without locking

**Solution:** Use database-level atomic increment with SELECT FOR UPDATE:

```python
# annotations.py - replace lines 36-105 with locked version

async def create_or_update_annotation(
    annotation_data: AnnotationCreate, db: DatabaseSession, current_user: CurrentUser
):
    # Use SELECT FOR UPDATE to lock the screenshot row
    screenshot_result = await db.execute(
        select(Screenshot)
        .where(Screenshot.id == annotation_data.screenshot_id)
        .with_for_update()  # ADD: Lock row
    )
    screenshot = screenshot_result.scalar_one_or_none()

    if not screenshot:
        raise HTTPException(status_code=404, detail="Screenshot not found")

    # ... rest of logic ...

    # For new annotations, use atomic increment
    if not existing:
        # Atomic increment using SQL expression
        await db.execute(
            update(Screenshot)
            .where(Screenshot.id == screenshot.id)
            .values(current_annotation_count=Screenshot.current_annotation_count + 1)
        )
        await db.commit()
```

**Alternative (simpler):** Use database trigger:

```sql
-- Alembic migration
CREATE OR REPLACE FUNCTION update_annotation_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE screenshots SET current_annotation_count = current_annotation_count + 1
        WHERE id = NEW.screenshot_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE screenshots SET current_annotation_count = GREATEST(0, current_annotation_count - 1)
        WHERE id = OLD.screenshot_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER annotation_count_trigger
AFTER INSERT OR DELETE ON annotations
FOR EACH ROW EXECUTE FUNCTION update_annotation_count();
```

---

### 1.5 UserQueueState Missing Unique Constraint

**Problem:** No unique constraint allows duplicate entries

**Solution:** Add migration with unique constraint:

```python
# alembic/versions/xxxx_add_userqueuestate_unique_constraint.py

def upgrade():
    # First, remove duplicates (keep most recent)
    op.execute("""
        DELETE FROM user_queue_states a
        USING user_queue_states b
        WHERE a.id < b.id
        AND a.user_id = b.user_id
        AND a.screenshot_id = b.screenshot_id
    """)

    # Add unique constraint
    op.create_unique_constraint(
        'uq_user_queue_state_user_screenshot',
        'user_queue_states',
        ['user_id', 'screenshot_id']
    )

def downgrade():
    op.drop_constraint('uq_user_queue_state_user_screenshot', 'user_queue_states')
```

**Update model:**

```python
# models.py - UserQueueState class
class UserQueueState(Base):
    __tablename__ = "user_queue_states"
    __table_args__ = (
        UniqueConstraint('user_id', 'screenshot_id', name='uq_user_queue_state_user_screenshot'),
    )
    # ... rest of model
```

---

### 1.6 Verification List Race Condition

**Problem:** JSON array modified without locking

**Solution:** Use SELECT FOR UPDATE and proper serialization:

```python
# screenshots.py - verify_screenshot endpoint

@router.post("/{screenshot_id}/verify")
async def verify_screenshot(screenshot_id: int, db: DatabaseSession, current_user: CurrentUser):
    # Lock the row for update
    result = await db.execute(
        select(Screenshot)
        .where(Screenshot.id == screenshot_id)
        .with_for_update()  # Prevents concurrent modifications
    )
    screenshot = result.scalar_one_or_none()

    if not screenshot:
        raise HTTPException(status_code=404, detail="Screenshot not found")

    # Now safe to modify
    verified_ids = list(screenshot.verified_by_user_ids or [])
    if current_user.id not in verified_ids:
        verified_ids.append(current_user.id)
        screenshot.verified_by_user_ids = verified_ids
        flag_modified(screenshot, "verified_by_user_ids")
        await db.commit()

    return {"verified": True, "verified_by_user_ids": verified_ids}
```

**Alternative (PostgreSQL-specific, more elegant):**

```python
# Use PostgreSQL array operators for atomic append
from sqlalchemy.dialects.postgresql import array_agg
from sqlalchemy import func

await db.execute(
    update(Screenshot)
    .where(Screenshot.id == screenshot_id)
    .where(~Screenshot.verified_by_user_ids.contains([current_user.id]))  # Only if not already present
    .values(
        verified_by_user_ids=func.array_append(
            Screenshot.verified_by_user_ids,
            current_user.id
        )
    )
)
```

---

## Part 2: High Priority Issues

### 2.1 Add Unskip Functionality

**Solution:** New endpoint and queue service method:

```python
# queue_service.py - add new method
@staticmethod
async def unmark_screenshot_skipped(db: AsyncSession, user_id: int, screenshot_id: int) -> bool:
    """Remove skip status for a screenshot, allowing it back in user's queue."""
    stmt = select(UserQueueState).where(
        and_(
            UserQueueState.user_id == user_id,
            UserQueueState.screenshot_id == screenshot_id,
            UserQueueState.status == "skipped"
        )
    )
    result = await db.execute(stmt)
    existing_state = result.scalar_one_or_none()

    if existing_state:
        existing_state.status = "pending"  # Reset to pending
        await db.commit()
        return True
    return False

# screenshots.py - add new endpoint
@router.post("/{screenshot_id}/unskip", status_code=status.HTTP_200_OK)
async def unskip_screenshot(
    screenshot_id: int,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    """Remove skip status for a screenshot, returning it to user's queue."""
    success = await QueueService.unmark_screenshot_skipped(db, current_user.id, screenshot_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found in your skipped list"
        )
    return {"success": True, "message": "Screenshot returned to your queue"}
```

**Frontend:**

```typescript
// apiClient.ts
unskip: async (screenshotId: number) => {
  const response = await axios.post(`/screenshots/${screenshotId}/unskip`);
  return response.data;
},

// AnnotationWorkspace.tsx - add unskip button for skipped screenshots
{screenshot.isSkippedByMe && (
  <button onClick={() => handleUnskip(screenshot.id)}>
    Return to Queue
  </button>
)}
```

---

### 2.2 Preserve Original Annotations in Dispute Resolution

**Solution:** Create separate resolved values, keep originals immutable:

```python
# models.py - add new field to Screenshot
class Screenshot(Base):
    # ... existing fields ...

    # Resolved consensus values (separate from user annotations)
    resolved_hourly_values: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    resolved_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

# consensus.py - update resolve_dispute
@router.post("/{screenshot_id}/resolve")
async def resolve_dispute(screenshot_id: int, request: ResolveDisputeRequest, ...):
    # ... validation ...

    # Store resolved values SEPARATELY - don't overwrite user annotations
    screenshot.resolved_hourly_values = request.hourly_values
    screenshot.resolved_by_user_id = current_user.id
    screenshot.resolved_at = datetime.utcnow()
    screenshot.resolution_notes = request.notes

    # Mark as resolved without changing original annotations
    screenshot.has_consensus = True

    # Log the resolution for audit trail
    resolution_log = ResolutionLog(
        screenshot_id=screenshot_id,
        resolved_by_user_id=current_user.id,
        original_annotations=[
            {"user_id": a.user_id, "hourly_values": a.hourly_values}
            for a in screenshot.annotations
        ],
        resolved_values=request.hourly_values,
        resolution_reason=request.notes,
    )
    db.add(resolution_log)

    await db.commit()
    return {"success": True}
```

---

### 2.3 Verified Screenshot Reprocess Feedback

**Solution:** Return explicit error instead of silent success:

```python
# processing_service.py lines 580-604
async def reprocess_screenshot(...):
    # Check if user has verified this screenshot
    if current_user_id and current_user_id in (screenshot.verified_by_user_ids or []):
        # BEFORE: Return old data with success=True
        # AFTER: Return error explaining the situation
        return {
            "success": False,
            "error": "cannot_reprocess_verified",
            "message": "You have verified this screenshot. Remove your verification first to enable reprocessing.",
            "verified_by_you": True,
            # Still include current data for reference
            "current_grid": {
                "upper_left": {"x": screenshot.grid_upper_left_x, "y": screenshot.grid_upper_left_y},
                "lower_right": {"x": screenshot.grid_lower_right_x, "y": screenshot.grid_lower_right_y},
            }
        }

    # ... proceed with normal reprocessing ...
```

**Frontend handling:**

```typescript
// AnnotationWorkspace.tsx
const handleReprocess = async (method: ProcessingMethod) => {
  try {
    const result = await reprocessWithMethod(method);
    if (!result.success && result.error === "cannot_reprocess_verified") {
      toast.error(result.message, {
        duration: 5000,
        action: {
          label: "Unverify",
          onClick: () => handleVerificationToggle(),
        },
      });
      return;
    }
    toast.success("Reprocessing complete");
  } catch (error) {
    toast.error("Reprocessing failed");
  }
};
```

---

### 2.4 Visible Processing Timeout

**Solution:** Add progress indicator and cancel button:

```typescript
// WASMProcessingService.ts - enhanced with visible timeout

processImage(imageData: ImageData): Promise<ProcessingResult> {
  return new Promise((resolve, reject) => {
    const id = this.messageId++;
    const startTime = Date.now();
    const TIMEOUT_MS = 30000;
    const WARNING_MS = 15000;

    // Progress callback
    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / TIMEOUT_MS * 100, 95);

      this.onProgress?.({
        stage: "processing",
        percent: progress,
        elapsed: Math.floor(elapsed / 1000),
        remaining: Math.ceil((TIMEOUT_MS - elapsed) / 1000),
      });

      // Warning at 15 seconds
      if (elapsed >= WARNING_MS && elapsed < WARNING_MS + 1000) {
        this.onWarning?.("Processing is taking longer than expected. You can cancel and try manual grid selection.");
      }
    };

    const progressInterval = setInterval(updateProgress, 500);

    const timeout = setTimeout(() => {
      clearInterval(progressInterval);
      this.pendingRequests.delete(id);
      reject(new Error(
        "Processing timed out after 30 seconds. Try selecting the grid manually."
      ));
    }, TIMEOUT_MS);

    // Store cancel function
    this.pendingRequests.set(id, {
      resolve: (result) => {
        clearInterval(progressInterval);
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (error) => {
        clearInterval(progressInterval);
        clearTimeout(timeout);
        reject(error);
      },
      cancel: () => {
        clearInterval(progressInterval);
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error("Processing cancelled by user"));
      },
    });

    this.worker.postMessage({ type: "PROCESS_IMAGE", id, payload: imageData });
  });
}

// Cancel method
cancelProcessing(id: number): void {
  const pending = this.pendingRequests.get(id);
  if (pending?.cancel) {
    pending.cancel();
  }
}
```

**UI Component:**

```tsx
// ProcessingOverlay.tsx
const ProcessingOverlay = ({ progress, onCancel }: Props) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-sm w-full">
        <h3 className="text-lg font-medium mb-4">Processing Screenshot</h3>

        <div className="mb-4">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            {progress.stage} - {progress.remaining}s remaining
          </p>
        </div>

        {progress.elapsed > 15 && (
          <p className="text-amber-600 text-sm mb-4">
            Taking longer than expected. You can cancel and try manual selection.
          </p>
        )}

        <button
          onClick={onCancel}
          className="w-full py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Cancel & Select Manually
        </button>
      </div>
    </div>
  );
};
```

---

### 2.5 Exclude Deleted Screenshots from Stats

**Solution:** Add filter to all stat queries:

```python
# screenshots.py - update stats endpoint

@router.get("/stats", response_model=StatsResponse)
async def get_stats(db: DatabaseSession, current_user: CurrentUser):
    # Base condition: exclude deleted
    not_deleted = Screenshot.processing_status != ProcessingStatus.DELETED

    # Total screenshots (excluding deleted)
    total_stmt = select(func.count(Screenshot.id)).where(not_deleted)
    result = await db.execute(total_stmt)
    total_screenshots = result.scalar_one()

    # Pending (excluding deleted)
    pending_stmt = select(func.count(Screenshot.id)).where(
        and_(
            Screenshot.processing_status == ProcessingStatus.PENDING,
            not_deleted  # Redundant but explicit
        )
    )
    # ... etc for all stats ...

    # Auto-processed (completed, excluding deleted)
    auto_processed_stmt = select(func.count(Screenshot.id)).where(
        and_(
            Screenshot.processing_status == ProcessingStatus.COMPLETED,
            not_deleted
        )
    )
```

**Better approach - create helper:**

```python
def active_screenshots_filter():
    """Returns SQLAlchemy condition for non-deleted screenshots."""
    return Screenshot.processing_status != ProcessingStatus.DELETED

# Usage:
stmt = select(func.count(Screenshot.id)).where(
    and_(
        active_screenshots_filter(),
        Screenshot.processing_status == ProcessingStatus.COMPLETED
    )
)
```

---

### 2.6 Bar Alignment Score Diagnostics

**Solution:** Return diagnostic reason with score:

```python
# image_processor.py - update compute_bar_alignment_score

def compute_bar_alignment_score(
    extracted_values: dict[str, float],
    computed_values: dict[str, float],
    img: np.ndarray,
    roi: tuple[int, int, int, int],
) -> tuple[float, str]:  # Return tuple with diagnostic
    """
    Returns (score, diagnostic_reason) tuple.
    """
    extracted_sum = sum(extracted_values.values())
    computed_sum = sum(computed_values.values())

    # Diagnose why score is low
    if extracted_sum == 0 and computed_sum == 0:
        return 1.0, "Both extractions empty - likely no data in this region"

    if extracted_sum == 0:
        return 0.1, "No bars detected in graph region - grid may be misaligned or wrong color mode"

    if computed_sum == 0:
        return 0.1, "Bar heights could not be computed - check grid boundaries"

    # Check for color detection issues
    if _detect_color_mismatch(img, roi):
        return 0.2, "Color detection mismatch - screenshot may be in dark mode"

    # Calculate actual alignment
    differences = []
    for hour in extracted_values:
        if hour in computed_values:
            diff = abs(extracted_values[hour] - computed_values[hour])
            differences.append(diff)

    if not differences:
        return 0.3, "No overlapping hours between extractions"

    avg_diff = sum(differences) / len(differences)
    max_possible = max(max(extracted_values.values(), default=1), max(computed_values.values(), default=1))

    if max_possible == 0:
        return 1.0, "All values are zero"

    score = 1.0 - (avg_diff / max_possible)
    score = max(0.0, min(1.0, score))

    if score < 0.5:
        diagnostic = "Large differences detected - try adjusting grid position"
    elif score < 0.7:
        diagnostic = "Minor alignment issues - small grid adjustment may help"
    else:
        diagnostic = "Good alignment"

    return score, diagnostic
```

**Frontend display:**

```tsx
// AlignmentWarning.tsx
const AlignmentWarning = ({ score, diagnostic }: Props) => {
  if (score >= 0.7) return null;

  return (
    <div className={`p-3 rounded ${score < 0.5 ? 'bg-red-50' : 'bg-amber-50'}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{score < 0.5 ? '⚠️' : '⚡'}</span>
        <span className="font-medium">
          Alignment: {Math.round(score * 100)}%
        </span>
      </div>
      <p className="text-sm text-gray-600 mt-1">{diagnostic}</p>

      {/* Actionable suggestions */}
      {diagnostic.includes("dark mode") && (
        <button className="text-blue-600 text-sm mt-2 underline">
          Try dark mode conversion
        </button>
      )}
      {diagnostic.includes("grid") && (
        <p className="text-sm text-gray-500 mt-1">
          Use WASD keys to adjust grid position
        </p>
      )}
    </div>
  );
};
```

---

## Part 3: UX Improvements

### 3.1 Rename Overlapping Status Values

**Solution:** Rename to be unambiguous:

```python
# models.py
class ProcessingStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    DAILY_TOTAL = "daily_total"  # Renamed from SKIPPED
    DELETED = "deleted"

class AnnotationStatus(str, Enum):
    PENDING = "pending"
    ANNOTATED = "annotated"
    VERIFIED = "verified"
    USER_SKIPPED = "user_skipped"  # Renamed from SKIPPED
```

**Migration:**

```python
def upgrade():
    # Update existing data
    op.execute("""
        UPDATE screenshots
        SET processing_status = 'daily_total'
        WHERE processing_status = 'skipped'
    """)
    op.execute("""
        UPDATE screenshots
        SET annotation_status = 'user_skipped'
        WHERE annotation_status = 'skipped'
    """)
```

---

### 3.2 Add Completion Signal

**Solution:** Set status and emit event when target reached:

```python
# annotations.py - after creating annotation

# Check if target reached
if screenshot.current_annotation_count >= screenshot.target_annotations:
    screenshot.annotation_status = AnnotationStatus.COMPLETE

    # Emit WebSocket event
    await websocket_manager.broadcast({
        "type": "screenshot_completed",
        "screenshot_id": screenshot.id,
        "final_count": screenshot.current_annotation_count,
    })

    # Lock from further annotations (optional)
    screenshot.is_locked = True

await db.commit()
```

---

### 3.3 Keyboard Shortcuts Enhancement

**Solution:** Add number keys and tab navigation:

```typescript
// useKeyboardShortcuts.ts - add new shortcuts

useKeyboardShortcuts([
  // Existing shortcuts...

  // Number keys 1-9 for quick value entry
  ...Array.from({ length: 9 }, (_, i) => ({
    key: String(i + 1),
    handler: () => {
      if (focusedHour !== null) {
        updateHour(focusedHour, (i + 1) * 10); // 10, 20, 30... 90
      }
    },
  })),

  // 0 for zero
  { key: "0", handler: () => focusedHour !== null && updateHour(focusedHour, 0) },

  // Tab to cycle hours
  {
    key: "Tab",
    handler: (e) => {
      e.preventDefault();
      setFocusedHour((prev) => (prev === null ? 0 : (prev + 1) % 24));
    }
  },

  // Shift+Tab to cycle backwards
  {
    key: "Tab",
    shift: true,
    handler: (e) => {
      e.preventDefault();
      setFocusedHour((prev) => (prev === null ? 23 : (prev - 1 + 24) % 24));
    }
  },

  // Shift+Enter to verify and advance
  {
    key: "Enter",
    shift: true,
    handler: () => {
      verifyCurrentScreenshot();
      navigateNext();
    },
  },

  // Ctrl+Z to undo last change
  {
    key: "z",
    ctrl: true,
    handler: () => undoLastChange(),
  },
]);
```

---

## Part 4: Feature Implementations

### 4.1 Priority Queue with Dispute Weighting

**Solution:** Update queue ordering:

```python
# queue_service.py - update get_next_screenshot

stmt = (
    select(Screenshot)
    .outerjoin(ConsensusResult)
    .where(and_(*conditions))
    .order_by(
        # 1. Disputed screenshots first (has_consensus = False)
        case(
            (ConsensusResult.has_consensus == False, 0),  # noqa: E712
            else_=1
        ),
        # 2. Low confidence scores
        case(
            (Screenshot.grid_detection_confidence < 0.5, 0),
            (Screenshot.grid_detection_confidence < 0.7, 1),
            else_=2
        ),
        # 3. Screenshots close to target (prioritize completion)
        (Screenshot.target_annotations - Screenshot.current_annotation_count).asc(),
        # 4. Processing status (completed first)
        Screenshot.processing_status.desc(),
        # 5. Oldest first
        Screenshot.uploaded_at.asc(),
    )
    .limit(1)
)
```

---

### 4.2 Bulk Operations

**Solution:** Add bulk endpoints and UI:

```python
# screenshots.py - bulk endpoints

class BulkOperationRequest(BaseModel):
    screenshot_ids: list[int]
    operation: Literal["delete", "restore", "reprocess"]

@router.post("/bulk", response_model=BulkOperationResponse)
async def bulk_operation(
    request: BulkOperationRequest,
    db: DatabaseSession,
    current_user: CurrentUser,
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    results = {"success": [], "failed": []}

    for screenshot_id in request.screenshot_ids:
        try:
            if request.operation == "delete":
                await soft_delete_screenshot(screenshot_id, db)
            elif request.operation == "restore":
                await restore_screenshot(screenshot_id, db)
            elif request.operation == "reprocess":
                await reprocess_screenshot(screenshot_id, db, current_user.id)
            results["success"].append(screenshot_id)
        except Exception as e:
            results["failed"].append({"id": screenshot_id, "error": str(e)})

    await db.commit()
    return results
```

**Frontend:**

```tsx
// BulkActionsBar.tsx
const BulkActionsBar = ({ selectedIds, onClear }: Props) => {
  const handleBulkAction = async (operation: string) => {
    const confirmed = await confirm(
      `Are you sure you want to ${operation} ${selectedIds.length} screenshots?`
    );
    if (!confirmed) return;

    const result = await api.screenshots.bulk({ screenshot_ids: selectedIds, operation });
    toast.success(`${result.success.length} succeeded, ${result.failed.length} failed`);
    onClear();
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white shadow-lg rounded-lg p-4 flex gap-4">
      <span>{selectedIds.length} selected</span>
      <button onClick={() => handleBulkAction("delete")}>Delete All</button>
      <button onClick={() => handleBulkAction("restore")}>Restore All</button>
      <button onClick={() => handleBulkAction("reprocess")}>Reprocess All</button>
      <button onClick={onClear}>Clear Selection</button>
    </div>
  );
};
```

---

### 4.3 Annotation Audit Trail

**Solution:** Add audit log table and automatic logging:

```python
# models.py - new AuditLog model

class AnnotationAuditLog(Base):
    __tablename__ = "annotation_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    annotation_id: Mapped[int] = mapped_column(ForeignKey("annotations.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(50))  # created, updated, resolved
    changed_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    previous_values: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    new_values: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

# Helper function
async def log_annotation_change(
    db: AsyncSession,
    annotation: Annotation,
    action: str,
    user_id: int,
    previous_values: dict | None = None,
    reason: str | None = None,
):
    log = AnnotationAuditLog(
        annotation_id=annotation.id,
        action=action,
        changed_by_user_id=user_id,
        previous_values=previous_values,
        new_values=annotation.hourly_values,
        reason=reason,
    )
    db.add(log)
```

---

### 4.4 Undo Functionality

**Solution:** Store undo stack in session:

```typescript
// useUndoStack.ts

interface UndoAction {
  type: "hourly_values" | "grid_coords" | "title";
  screenshotId: number;
  previousValue: any;
  timestamp: number;
}

export const useUndoStack = () => {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const maxStackSize = 20;

  const pushUndo = (action: Omit<UndoAction, "timestamp">) => {
    setUndoStack((prev) => [
      { ...action, timestamp: Date.now() },
      ...prev.slice(0, maxStackSize - 1),
    ]);
  };

  const popUndo = (): UndoAction | null => {
    if (undoStack.length === 0) return null;
    const [action, ...rest] = undoStack;
    setUndoStack(rest);
    return action;
  };

  const undo = async () => {
    const action = popUndo();
    if (!action) {
      toast.info("Nothing to undo");
      return;
    }

    // Apply previous value
    switch (action.type) {
      case "hourly_values":
        await restoreHourlyValues(action.screenshotId, action.previousValue);
        break;
      case "grid_coords":
        await restoreGridCoords(action.screenshotId, action.previousValue);
        break;
      case "title":
        await restoreTitle(action.screenshotId, action.previousValue);
        break;
    }

    toast.success("Undone");
  };

  return { pushUndo, undo, canUndo: undoStack.length > 0 };
};
```

---

## Summary: Implementation Priority

### Week 1 (Critical)
1. Fix 5 SQLAlchemy `is True/False` bugs
2. Fix consensus schema mismatch
3. Add UserQueueState unique constraint
4. Fix grid detection error handling

### Week 2 (High)
5. Add unskip endpoint
6. Fix race conditions (annotation count, verified_by)
7. Add processing timeout visibility
8. Exclude deleted from stats

### Week 3-4 (Medium)
9. Preserve original annotations in dispute resolution
10. Add alignment score diagnostics
11. Rename overlapping status values
12. Add completion signal

### Month 2 (Features)
13. Priority queue improvements
14. Bulk operations
15. Annotation audit trail
16. Undo functionality
17. Keyboard shortcuts enhancement

---

*Solutions document generated by Claude Code*
