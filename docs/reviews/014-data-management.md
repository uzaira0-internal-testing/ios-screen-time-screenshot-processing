# Data Management Review

## 1. Data Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            DATA FLOW DIAGRAM                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌────────────┐    Upload API     ┌───────────────┐    OCR/Grid    ┌─────────┐ │
│   │   Client   │ ────────────────► │   FastAPI     │ ────────────► │ Celery  │ │
│   │ (Browser)  │                   │   Backend     │                │ Worker  │ │
│   └────────────┘                   └───────────────┘                └─────────┘ │
│         │                                 │                              │       │
│         │                                 ▼                              │       │
│         │                          ┌───────────────┐                     │       │
│         │                          │  PostgreSQL   │◄────────────────────┘       │
│         │                          │  (Metadata)   │                             │
│         │                          └───────────────┘                             │
│         │                                 │                                      │
│         │                                 ▼                                      │
│         │                          ┌───────────────┐                             │
│         │                          │  File System  │                             │
│         │                          │  (Uploads)    │                             │
│         │                          └───────────────┘                             │
│         │                                                                        │
│   WASM MODE ONLY:                                                                │
│         │                                                                        │
│         │                          ┌───────────────┐                             │
│         └─────────────────────────►│  IndexedDB    │                             │
│                                    │  (LocalForage)│                             │
│                                    └───────────────┘                             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Design Review

### 2.1 Schema Quality Assessment

**Models Location:** `src/screenshot_processor/web/database/models.py`

| Table | Purpose | Status |
|-------|---------|--------|
| `users` | User accounts | Good |
| `groups` | Study group organization | Good |
| `screenshots` | Screenshot metadata + processing results | Complex but justified |
| `annotations` | User annotation submissions | Good |
| `processing_issues` | OCR/grid detection issues | Good |
| `user_queue_state` | User's position in annotation queue | Good |
| `consensus_results` | Consensus calculation results | Good |

### 2.2 Index Coverage (Good)

**Location:** `models.py:75-79`

```python
__table_args__ = (
    Index("ix_screenshots_group_processing", "group_id", "processing_status"),
    Index("ix_screenshots_group_date", "group_id", "screenshot_date"),
    Index("ix_screenshots_group_id_asc", "group_id", "id"),
)
```

| Query Pattern | Index | Coverage |
|---------------|-------|----------|
| Screenshots by group + status | `ix_screenshots_group_processing` | Full |
| Screenshots by group + date | `ix_screenshots_group_date` | Full |
| Screenshot list in group order | `ix_screenshots_group_id_asc` | Full |
| User annotations | `user_id` FK index | Full |
| Consensus by screenshot | `screenshot_id` FK index | Full |

### 2.3 Normalization Assessment

**Current Level:** 3NF (Third Normal Form)

- No transitive dependencies
- No repeating groups
- Proper foreign key relationships

**One Concern:** `screenshots` table has many columns (30+) that could be split:

```python
# Current: Single large table
Screenshot:
  - id, file_path, group_id, participant_id  # Identity
  - processing_status, processing_method    # Processing state
  - extracted_title, extracted_total        # OCR results
  - extracted_hourly_data                   # Bar values (JSON)
  - grid_upper_left_x, grid_upper_left_y   # Grid coordinates
  - grid_lower_right_x, grid_lower_right_y
  - alignment_score, grid_detection_confidence  # Quality metrics
  - processing_issues                        # Issues (JSON)
```

**Recommendation:** Consider splitting into `screenshots` + `processing_results` tables for cleaner separation. However, current design is acceptable for the data volume expected.

### 2.4 Foreign Key Relationships

```
users ────────────┬──────────────► annotations
     └──────────► user_queue_state

groups ──────────► screenshots ──► annotations
                       │
                       └──────────► processing_issues
                       └──────────► consensus_results
```

All relationships have proper `ondelete` cascading configured.

---

## 3. Data Integrity Analysis

### 3.1 Constraint Definitions

| Constraint | Type | Location | Status |
|------------|------|----------|--------|
| Screenshot IDs | Primary Key | models.py | Enforced |
| User uniqueness | Unique username | models.py:44 | Enforced |
| Group uniqueness | Unique group_id | models.py:62 | Enforced |
| Annotation per user/screenshot | Upsert logic | annotations.py:43-51 | Application-level |

**Gap:** Annotation uniqueness is enforced at application level, not database level.

**Recommendation:** Add unique constraint:

```python
__table_args__ = (
    UniqueConstraint("screenshot_id", "user_id", name="uq_annotation_user_screenshot"),
)
```

### 3.2 Transaction Handling (Good)

**Location:** `annotations.py:53-129`

```python
try:
    if existing:
        # UPDATE existing annotation
        existing.hourly_values = annotation_data.hourly_values
        ...
        await db.commit()
        await db.refresh(existing)
    else:
        # CREATE new annotation
        db.add(new_annotation)
        screenshot.current_annotation_count += 1
        await db.commit()
        ...
except Exception as e:
    await db.rollback()  # Proper rollback
    raise HTTPException(...)
```

All route handlers properly:
- Use explicit `await db.commit()` for success
- Call `await db.rollback()` on errors
- Use `await db.refresh()` to get updated values

### 3.3 Race Condition Handling

**Potential Issue:** `current_annotation_count` increment

**Location:** `annotations.py:105-106`

```python
screenshot.current_annotation_count += 1
```

This is **not atomic** - two simultaneous submissions could both read the same count and increment to the same value.

**Mitigation Options:**
1. Use database-level `UPDATE ... SET count = count + 1`
2. Use PostgreSQL `SELECT FOR UPDATE` for row-level locking
3. Recalculate count from actual annotations on each query

**Risk:** Low for current use case (few concurrent annotators).

### 3.4 Orphaned Data Prevention

| Scenario | Protection | Status |
|----------|------------|--------|
| Delete user | Cascade delete annotations | Configured |
| Delete screenshot | Cascade delete annotations | Configured |
| Delete group | Cascade delete screenshots | Configured |
| Delete file but keep metadata | None | Potential gap |

**Gap:** If a file is deleted from disk, the database record remains. No scheduled cleanup.

---

## 4. State Management Review

### 4.1 Zustand Store Architecture (Good)

**Location:** `frontend/src/store/createAnnotationStore.ts`

```typescript
// Store instances keyed by groupId + processingStatus
const storeInstances = new Map<string, StoreEntry>();

// Reference counting for cleanup
interface StoreEntry {
  store: ReturnType<typeof createAnnotationStore>;
  refCount: number;
}
```

**Positive:**
- Store reuse across components with same filters
- Reference counting prevents premature cleanup
- Delayed cleanup (5s) handles React strict mode

### 4.2 State Synchronization

| Feature | Implementation | Status |
|---------|----------------|--------|
| Auto-save | `useAutoSave.ts` with debounce | Good |
| Optimistic updates | Immediate UI updates | Good |
| Rollback on error | Not implemented | Gap |
| Cache invalidation | Manual refresh | Partial |

**Auto-save Flow:**

```typescript
// useAutoSave.ts (inferred from usage)
- Debounce value changes
- Save after inactivity
- Track lastSaved timestamp
- Show save status indicator
```

### 4.3 Offline Support (WASM Mode)

**IndexedDB Storage:**
- Screenshots stored locally
- Annotations stored locally
- Processing runs client-side (Tesseract.js)

**Gap:** No sync mechanism when reconnecting to server.

---

## 5. File Storage

### 5.1 Upload Handling

**Location:** `screenshots.py` (upload route)

```python
# File organization
uploads/
├── screenshots/
│   ├── {group_id}/
│   │   ├── {participant_id}/
│   │   │   ├── {filename}_{hash}.png
```

| Feature | Status |
|---------|--------|
| Filename sanitization | Implemented |
| Hash collision prevention | UUID suffix |
| Path traversal protection | Implemented |
| Max file size | 50MB (nginx) |
| File type validation | Image types only |

### 5.2 Storage Concerns

| Concern | Status | Notes |
|---------|--------|-------|
| Disk space monitoring | Not implemented | No alerts |
| Orphaned file cleanup | Not implemented | Files persist after DB deletion |
| Backup strategy | Not documented | Local storage only |
| CDN/Cloud storage | Not implemented | Local disk only |

**Recommendation:** For production:
1. Implement scheduled cleanup of orphaned files
2. Add disk space monitoring
3. Consider S3/MinIO for scalable storage
4. Document backup procedures

---

## 6. Backup & Recovery Assessment

### 6.1 Current State

| Component | Backup Mechanism | Recovery Point Objective |
|-----------|------------------|--------------------------|
| PostgreSQL | None configured | N/A |
| File uploads | None configured | N/A |
| IndexedDB (WASM) | Browser-managed | N/A |

### 6.2 Recommended Strategy

**PostgreSQL:**
```bash
# Recommended: Daily backups with pg_dump
pg_dump -h localhost -U screenshot -d screenshot_annotations > backup.sql

# Or use pg_basebackup for point-in-time recovery
```

**File Storage:**
```bash
# Recommended: rsync to backup location
rsync -av uploads/ /backup/uploads/
```

**Recovery Time Objective:** Define based on data criticality.

---

## 7. Data Loss Risk Matrix

| Scenario | Likelihood | Impact | Mitigation |
|----------|------------|--------|------------|
| Database corruption | Low | High | No backup = total loss |
| Accidental deletion | Medium | Medium | No soft deletes |
| Disk failure | Low | High | No redundancy |
| Network failure during save | Medium | Low | Auto-save has retry |
| Concurrent edit conflict | Low | Low | Last-write-wins |
| File without DB record | Low | Low | Orphaned file only |
| DB record without file | Low | Medium | Broken screenshot |

---

## 8. Performance Considerations

### 8.1 Query Patterns

| Query | Frequency | Optimization |
|-------|-----------|--------------|
| Next screenshot in queue | Very High | Indexed on group + status |
| List screenshots | High | Indexed, paginated |
| Get screenshot by ID | High | Primary key lookup |
| Create/update annotation | Medium | Single row operations |
| Consensus calculation | Medium | Triggers on annotation count |

### 8.2 Connection Pooling (Good)

**Location:** `database.py:39-46`

```python
engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,    # Health check
    pool_size=10,          # Persistent connections
    max_overflow=20,       # Burst capacity
    pool_recycle=3600,     # 1 hour recycle
)
```

### 8.3 Potential N+1 Queries

**Location:** `annotations.py:152-156`

```python
for annotation in annotations:
    issues_result = await db.execute(
        select(ProcessingIssue).where(ProcessingIssue.annotation_id == annotation.id)
    )
```

**Recommendation:** Use eager loading:

```python
stmt = (
    select(Annotation)
    .options(selectinload(Annotation.issues))
    .where(Annotation.user_id == current_user.id)
)
```

---

## 9. Recommended Improvements

### Priority 1: Critical (Data Safety)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 1.1 | Implement PostgreSQL backup script | 2 hours | High |
| 1.2 | Add file backup strategy | 2 hours | High |
| 1.3 | Add unique constraint for annotation per user/screenshot | 30 min | Medium |

### Priority 2: High (Data Integrity)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 2.1 | Fix race condition on annotation count | 2 hours | Medium |
| 2.2 | Add orphaned file cleanup job | 4 hours | Medium |
| 2.3 | Add soft delete for screenshots | 4 hours | Medium |

### Priority 3: Medium (Performance)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 3.1 | Fix N+1 queries with eager loading | 2 hours | Low |
| 3.2 | Add Redis caching for frequently accessed data | 8 hours | Low |

### Priority 4: Low (Scalability)

| # | Improvement | Effort | Impact |
|---|-------------|--------|--------|
| 4.1 | Migrate file storage to S3/MinIO | 8 hours | Low (for current scale) |
| 4.2 | Add read replicas for PostgreSQL | 8 hours | Low |

---

## 10. Conclusion

**Overall Assessment: ACCEPTABLE** (for current scale)

The data management practices are sound for an internal research tool:

**Strengths:**
- Proper relational design with foreign keys
- Good index coverage for common queries
- Transaction handling with proper rollback
- Connection pooling configured
- Path traversal protection

**Gaps:**
- No backup strategy documented or automated
- No orphaned file cleanup
- Race condition on annotation count (low risk)
- N+1 query patterns in some routes

**Recommendations:**
1. **Immediate:** Document and implement backup strategy
2. **Soon:** Add unique constraint for annotation uniqueness
3. **Later:** Implement orphaned file cleanup

For production deployment, the backup strategy is the most critical gap to address.
