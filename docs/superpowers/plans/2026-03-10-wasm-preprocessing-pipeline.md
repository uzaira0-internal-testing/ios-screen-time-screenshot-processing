# WASM Preprocessing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 4-stage preprocessing pipeline (device detection, cropping, PHI detection, PHI redaction) to run client-side in WASM mode, using the same UI as server mode.

**Architecture:** Create an `IPreprocessingService` interface with server and WASM implementations. The server impl wraps existing `api.preprocessing.*` calls. The WASM impl runs all 4 stages client-side using canvas APIs, Tesseract.js, and regex-based PHI detection. Refactor the `preprocessingStore` to accept the service via a factory function instead of importing `api` directly. Delete `WASMPreprocessingPage` and use the same `PreprocessingPage` for both modes.

**Tech Stack:** TypeScript, Canvas API, Tesseract.js (already in project), Zustand, Dexie (IndexedDB)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `frontend/src/core/interfaces/IPreprocessingService.ts` | Service contract for preprocessing operations |
| CREATE | `frontend/src/core/implementations/server/ServerPreprocessingService.ts` | Server impl wrapping `api.preprocessing.*` |
| CREATE | `frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts` | WASM impl orchestrating all 4 stages |
| CREATE | `frontend/src/core/implementations/wasm/preprocessing/deviceDetection.ts` | iOS device profile database + dimension matcher |
| CREATE | `frontend/src/core/implementations/wasm/preprocessing/cropping.ts` | Canvas-based iPad screenshot cropping |
| CREATE | `frontend/src/core/implementations/wasm/preprocessing/phiDetection.ts` | OCR + regex-based PHI detection |
| CREATE | `frontend/src/core/implementations/wasm/preprocessing/phiRedaction.ts` | Canvas-based image redaction (redbox/blackbox/pixelate) |
| MODIFY | `frontend/src/core/di/tokens.ts` | Add PREPROCESSING_PIPELINE_SERVICE token |
| MODIFY | `frontend/src/core/di/bootstrap.ts` | Register ServerPreprocessingService |
| MODIFY | `frontend/src/core/di/bootstrapWasm.ts` | Register WASMPreprocessingService |
| MODIFY | `frontend/src/core/hooks/useServices.ts` | Add usePreprocessingService hook |
| MODIFY | `frontend/src/store/preprocessingStore.ts` | Accept IPreprocessingService, remove direct `api.*` calls |
| MODIFY | `frontend/src/pages/PreprocessingPage.tsx` | Remove `api` import, use store (which uses DI service) |
| MODIFY | `frontend/src/components/routing/AppRouter.tsx` | Remove WASMPreprocessingPage, use PreprocessingPage for both |
| DELETE | `frontend/src/pages/WASMPreprocessingPage.tsx` | Replaced by unified PreprocessingPage |

---

## Chunk 1: Interface + DI Wiring

### Task 1: Create IPreprocessingService Interface

**Files:**
- Create: `frontend/src/core/interfaces/IPreprocessingService.ts`
- Modify: `frontend/src/core/interfaces/index.ts`

This interface matches what the `preprocessingStore` needs. Every `api.preprocessing.*` call becomes a method.

- [ ] **Step 1: Create the interface file**

```typescript
// frontend/src/core/interfaces/IPreprocessingService.ts
import type { Screenshot, Group, PreprocessingStageSummary, PreprocessingSummary, PreprocessingEventLog } from "@/types";

export type Stage = "device_detection" | "cropping" | "phi_detection" | "phi_redaction";

export interface RunStageOptions {
  group_id?: string;
  screenshot_ids?: number[];
  phi_pipeline_preset?: string;
  phi_redaction_method?: string;
  llm_endpoint?: string;
  llm_model?: string;
}

export interface RunStageResult {
  queued_count: number;
  message: string;
  screenshot_ids?: number[];
}

export interface ResetStageResult {
  message: string;
}

export interface UploadBrowserResult {
  successful?: number;
  failed: number;
  results?: Array<{ success: boolean; error?: string; index: number }>;
}

export interface IPreprocessingService {
  /** Load groups list */
  getGroups(): Promise<Group[]>;

  /** Load screenshots for a group (paginated) */
  getScreenshots(params: {
    group_id: string;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<{ items: Screenshot[]; total: number }>;

  /** Get preprocessing summary counts for a group */
  getSummary(groupId: string): Promise<PreprocessingSummary>;

  /** Run a preprocessing stage on eligible screenshots */
  runStage(stage: Stage, options: RunStageOptions): Promise<RunStageResult>;

  /** Reset a stage for all screenshots in a group */
  resetStage(stage: Stage, groupId: string): Promise<ResetStageResult>;

  /** Invalidate all stages downstream of the given stage for a screenshot */
  invalidateFromStage(screenshotId: number, stage: string): Promise<void>;

  /** Get event log for a screenshot */
  getEventLog(screenshotId: number): Promise<PreprocessingEventLog>;

  /** Get a single screenshot by ID */
  getScreenshot(screenshotId: number): Promise<Screenshot | null>;

  /** Upload screenshots via browser (server: multipart FormData, WASM: local storage) */
  uploadBrowser(formData: FormData): Promise<UploadBrowserResult>;

  /** Get URL for original (unprocessed) image */
  getOriginalImageUrl(screenshotId: number): Promise<string>;

  /** Apply manual crop adjustment */
  applyManualCrop(screenshotId: number, crop: {
    left: number; top: number; right: number; bottom: number;
  }): Promise<void>;

  /** Get PHI regions for a screenshot */
  getPHIRegions(screenshotId: number): Promise<any>;

  /** Save manually edited PHI regions */
  savePHIRegions(screenshotId: number, body: {
    regions: Array<{ x: number; y: number; w: number; h: number; label: string; source: string; confidence: number; text: string }>;
    preset: string;
  }): Promise<void>;

  /** Apply redaction to a screenshot */
  applyRedaction(screenshotId: number, body: {
    regions: Array<{ x: number; y: number; w: number; h: number; label: string; source: string; confidence: number; text: string }>;
    redaction_method: string;
  }): Promise<void>;

  /** Get preprocessing details for a screenshot */
  getDetails(screenshotId: number): Promise<any>;
}
```

- [ ] **Step 2: Export from interfaces index**

Add to `frontend/src/core/interfaces/index.ts`:
```typescript
export type { IPreprocessingService, Stage as PreprocessingStage, RunStageOptions, RunStageResult } from "./IPreprocessingService";
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/interfaces/IPreprocessingService.ts frontend/src/core/interfaces/index.ts
git commit -m "feat: add IPreprocessingService interface for preprocessing DI"
```

### Task 2: Add DI Token + Hook

**Files:**
- Modify: `frontend/src/core/di/tokens.ts`
- Modify: `frontend/src/core/hooks/useServices.ts`

- [ ] **Step 1: Add token**

In `tokens.ts`, add to TOKENS:
```typescript
PREPROCESSING_PIPELINE_SERVICE: "IPreprocessingService",
```

- [ ] **Step 2: Add hook**

In `useServices.ts`, add:
```typescript
import type { IPreprocessingService } from "../interfaces/IPreprocessingService";

export function usePreprocessingPipelineService(): IPreprocessingService {
  const container = useServiceContainer();
  return container.resolve<IPreprocessingService>(TOKENS.PREPROCESSING_PIPELINE_SERVICE);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/di/tokens.ts frontend/src/core/hooks/useServices.ts
git commit -m "feat: add PREPROCESSING_PIPELINE_SERVICE DI token and hook"
```

### Task 3: Server Implementation

**Files:**
- Create: `frontend/src/core/implementations/server/ServerPreprocessingService.ts`
- Modify: `frontend/src/core/di/bootstrap.ts`

This wraps all `api.preprocessing.*` calls from `apiClient.ts`.

- [ ] **Step 1: Create ServerPreprocessingService**

```typescript
// frontend/src/core/implementations/server/ServerPreprocessingService.ts
import type { IPreprocessingService, RunStageOptions, RunStageResult, ResetStageResult, UploadBrowserResult } from "@/core/interfaces/IPreprocessingService";
import type { Screenshot, Group, PreprocessingSummary, PreprocessingEventLog } from "@/types";
import { api } from "@/services/apiClient";

export class ServerPreprocessingService implements IPreprocessingService {
  async getGroups(): Promise<Group[]> {
    const data = await api.groups.list();
    return (data ?? []) as Group[];
  }

  async getScreenshots(params: {
    group_id: string;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<{ items: Screenshot[]; total: number }> {
    const data = await api.screenshots.list({
      group_id: params.group_id,
      page_size: params.page_size ?? 5000,
      sort_by: params.sort_by ?? "id",
      sort_order: (params.sort_order as "asc" | "desc") ?? "asc",
    });
    return { items: data?.items ?? [], total: data?.total ?? 0 };
  }

  async getSummary(groupId: string): Promise<PreprocessingSummary> {
    const data = await api.preprocessing.getSummary(groupId);
    return data as PreprocessingSummary;
  }

  async runStage(stage: string, options: RunStageOptions): Promise<RunStageResult> {
    const result = await api.preprocessing.runStage(stage, options);
    return result;
  }

  async resetStage(stage: string, groupId: string): Promise<ResetStageResult> {
    const result = await api.preprocessing.resetStage(stage, groupId);
    return result;
  }

  async invalidateFromStage(screenshotId: number, stage: string): Promise<void> {
    await api.preprocessing.invalidateFromStage(screenshotId, stage);
  }

  async getEventLog(screenshotId: number): Promise<PreprocessingEventLog> {
    return await api.preprocessing.getEventLog(screenshotId) as PreprocessingEventLog;
  }

  async getScreenshot(screenshotId: number): Promise<Screenshot | null> {
    return await api.screenshots.getById(screenshotId);
  }

  async uploadBrowser(formData: FormData): Promise<UploadBrowserResult> {
    return await api.preprocessing.uploadBrowser(formData);
  }

  async getOriginalImageUrl(screenshotId: number): Promise<string> {
    return await api.preprocessing.getOriginalImageUrl(screenshotId);
  }

  async applyManualCrop(screenshotId: number, crop: { left: number; top: number; right: number; bottom: number }): Promise<void> {
    await api.preprocessing.applyManualCrop(screenshotId, crop);
  }

  async getPHIRegions(screenshotId: number): Promise<any> {
    return await api.preprocessing.getPHIRegions(screenshotId);
  }

  async savePHIRegions(screenshotId: number, body: any): Promise<void> {
    await api.preprocessing.savePHIRegions(screenshotId, body);
  }

  async applyRedaction(screenshotId: number, body: any): Promise<void> {
    await api.preprocessing.applyRedaction(screenshotId, body);
  }

  async getDetails(screenshotId: number): Promise<any> {
    return await api.preprocessing.getDetails(screenshotId);
  }
}
```

- [ ] **Step 2: Register in server bootstrap**

In `bootstrap.ts`, add:
```typescript
import { ServerPreprocessingService } from "../implementations/server/ServerPreprocessingService";

// Inside bootstrapServerServices():
container.registerSingleton(
  TOKENS.PREPROCESSING_PIPELINE_SERVICE,
  () => new ServerPreprocessingService(),
);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/implementations/server/ServerPreprocessingService.ts frontend/src/core/di/bootstrap.ts
git commit -m "feat: add ServerPreprocessingService wrapping api.preprocessing"
```

---

## Chunk 2: WASM Preprocessing Stages (Client-Side Processing)

### Task 4: Device Detection (WASM)

**Files:**
- Create: `frontend/src/core/implementations/wasm/preprocessing/deviceDetection.ts`

Port the iOS device profile database and dimension-matching logic from the Python `ios-device-detector` package. Pure TypeScript — no dependencies.

- [ ] **Step 1: Create device detection module**

This file contains:
1. All iPhone/iPad device profiles (from Python `iphone.py` and `ipad.py`)
2. Dimension matching with tolerance (from Python `detector.py`)
3. A `detectDevice(width, height)` function that returns detection result

Key profiles to include (from Python source):
- iPhone SE through 15 Pro Max (all screen dimensions × scale factors)
- iPad 9th/10th, Mini 5th/6th, Air 3rd-5th, Pro 11" 1st-4th, Pro 12.9" 3rd-6th

The detection logic:
1. Check exact dimension match (portrait + landscape) → confidence 1.0
2. Check within tolerance (±5px) → confidence 0.8-0.99
3. Check partial crop (width matches, height shorter) → confidence 0.7-0.85
4. Check aspect ratio only → confidence 0.5-0.6
5. No match → detected: false

- [ ] **Step 2: Commit**

```bash
git add frontend/src/core/implementations/wasm/preprocessing/deviceDetection.ts
git commit -m "feat: add client-side iOS device detection from image dimensions"
```

### Task 5: Cropping (WASM)

**Files:**
- Create: `frontend/src/core/implementations/wasm/preprocessing/cropping.ts`

Port the iPad screenshot cropper. Uses Canvas API instead of OpenCV.

- [ ] **Step 1: Create cropping module**

Logic (from Python `cropper.py`):
1. `shouldCrop(width, height)`: Check if image is iPad format needing crop
   - Skip if already cropped (990×2160)
   - Skip if landscape
   - Skip if too small
   - Process if 1620×2160 (±10px tolerance)
2. `cropScreenshot(imageBlob, deviceInfo)`: Canvas-based crop
   - Load blob into Image element
   - Draw to canvas at crop region (x=630, y=0, w=990, h=2160)
   - Export as PNG blob
   - Return { croppedBlob, wasCropped, wasPatched, originalDimensions, croppedDimensions }

No patching in WASM (requires bundled patch image assets — skip for now, mark as not-patched).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/core/implementations/wasm/preprocessing/cropping.ts
git commit -m "feat: add client-side iPad screenshot cropping via canvas"
```

### Task 6: PHI Detection (WASM)

**Files:**
- Create: `frontend/src/core/implementations/wasm/preprocessing/phiDetection.ts`

WASM mode uses Tesseract.js (already in project) + regex patterns instead of Presidio NER. No LLM support in WASM mode.

- [ ] **Step 1: Create PHI detection module**

Strategy:
1. Run Tesseract.js OCR on the image to get text with bounding boxes
2. Apply regex patterns against extracted text to find:
   - Email addresses: `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/`
   - Phone numbers: `/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/`
   - SSN: `/\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/`
   - Dates with names context: `/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/`
   - Names (capitalized words that aren't common iOS UI elements): heuristic-based
3. Map regex matches back to OCR bounding boxes
4. Apply allow-list (common iOS Screen Time UI strings to ignore)
5. Filter by minimum bbox area (>100 sq pixels)

Return `PHIRegion[]` with `{ x, y, w, h, label, source, confidence, text }`.

The allow-list should include: common app names ("Safari", "Messages", "Photos", etc.), UI labels ("Screen Time", "Daily Average", "Pickups", etc.), time strings ("12 AM", "60", "h", "m").

- [ ] **Step 2: Commit**

```bash
git add frontend/src/core/implementations/wasm/preprocessing/phiDetection.ts
git commit -m "feat: add client-side PHI detection via Tesseract.js + regex"
```

### Task 7: PHI Redaction (WASM)

**Files:**
- Create: `frontend/src/core/implementations/wasm/preprocessing/phiRedaction.ts`

Canvas-based redaction. Port of Python `remover.py`.

- [ ] **Step 1: Create redaction module**

Three methods:
1. **redbox**: Draw red filled rectangle over each region
2. **blackbox**: Draw black filled rectangle over each region
3. **pixelate**: Scale down region, scale back up with nearest-neighbor

```typescript
export async function redactImage(
  imageBlob: Blob,
  regions: PHIRegion[],
  method: "redbox" | "blackbox" | "pixelate",
  padding?: number,
): Promise<Blob>
```

Implementation:
1. Load blob into Image, draw to canvas
2. For each region: apply padding, then draw/pixelate
3. Export canvas as PNG blob

- [ ] **Step 2: Commit**

```bash
git add frontend/src/core/implementations/wasm/preprocessing/phiRedaction.ts
git commit -m "feat: add client-side PHI redaction via canvas"
```

---

## Chunk 3: WASM Orchestrator + Store Refactor

### Task 8: WASMPreprocessingService

**Files:**
- Create: `frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts`
- Modify: `frontend/src/core/di/bootstrapWasm.ts`

This orchestrator implements `IPreprocessingService` by:
- Storing preprocessing metadata in `screenshot.processing_metadata` (same JSON structure as server)
- Running stages synchronously (no Celery — immediate execution)
- Using IndexedDB for screenshots and OPFS for image blobs (via existing storage service)

- [ ] **Step 1: Create WASMPreprocessingService**

Key design decisions:
- `runStage()` processes screenshots **synchronously** (no polling needed)
  - For each eligible screenshot: load blob → run stage function → update metadata → save blob (if new output)
  - Returns `{ queued_count: N, message: "Processed N screenshots" }` after all are done
- `getSummary()` computes counts from `processing_metadata.preprocessing.stage_status` fields
- `getEventLog()` reads from `processing_metadata.preprocessing.events` array
- `resetStage()` sets stage_status back to "pending" + invalidates downstream
- `invalidateFromStage()` sets downstream stages to "invalidated"
- `getScreenshots()` delegates to storage service's paginated query
- `getGroups()` delegates to WASMScreenshotService's getGroups

Since processing is synchronous, no polling is needed. The store's polling logic will detect `running === 0` immediately on next summary load and stop.

- [ ] **Step 2: Register in WASM bootstrap**

In `bootstrapWasm.ts`, add:
```typescript
import { WASMPreprocessingService } from "../implementations/wasm/preprocessing/WASMPreprocessingService";

// Inside bootstrapWasmServices():
container.registerSingleton(TOKENS.PREPROCESSING_PIPELINE_SERVICE, () => {
  const storage = container.resolve<IndexedDBStorageService>(TOKENS.STORAGE_SERVICE);
  const processing = container.resolve<WASMProcessingService>(TOKENS.PROCESSING_SERVICE);
  return new WASMPreprocessingService(storage, processing);
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts frontend/src/core/di/bootstrapWasm.ts
git commit -m "feat: add WASMPreprocessingService orchestrating client-side stages"
```

### Task 9: Refactor preprocessingStore to Use DI

**Files:**
- Modify: `frontend/src/store/preprocessingStore.ts`

The store currently imports `api` directly and calls `api.preprocessing.*`, `api.groups.*`, `api.screenshots.*`. Refactor to accept an `IPreprocessingService` parameter.

- [ ] **Step 1: Convert store to factory function**

Change from:
```typescript
export const usePreprocessingStore = create<PreprocessingState>((set, get) => ({
  // ... uses `api.*` directly
}));
```

To:
```typescript
export function createPreprocessingStore(service: IPreprocessingService) {
  return create<PreprocessingState>((set, get) => ({
    // ... uses `service.*` instead of `api.*`
  }));
}
```

Replace every `api.preprocessing.*` call with the corresponding `service.*` call:
- `api.groups.list()` → `service.getGroups()`
- `api.screenshots.list(...)` → `service.getScreenshots(...)`
- `api.preprocessing.getSummary(...)` → `service.getSummary(...)`
- `api.preprocessing.runStage(...)` → `service.runStage(...)`
- `api.preprocessing.resetStage(...)` → `service.resetStage(...)`
- `api.preprocessing.invalidateFromStage(...)` → `service.invalidateFromStage(...)`
- `api.preprocessing.getEventLog(...)` → `service.getEventLog(...)`
- `api.screenshots.getById(...)` → `service.getScreenshot(...)`
- `api.preprocessing.uploadBrowser(...)` → `service.uploadBrowser(...)`

The store is created once during app bootstrap and provided via React context or a module-level singleton that's initialized at boot.

- [ ] **Step 2: Create a provider/hook for the store**

Since the store needs the DI service, create it in a React context similar to how the annotation store works:

```typescript
// In PreprocessingPage.tsx or a new provider:
const service = usePreprocessingPipelineService();
const store = useMemo(() => createPreprocessingStore(service), [service]);
```

Or simpler: initialize the store once in a module that's called during bootstrap.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/preprocessingStore.ts
git commit -m "refactor: preprocessingStore accepts IPreprocessingService via DI"
```

### Task 10: Unify PreprocessingPage + Delete WASMPreprocessingPage

**Files:**
- Modify: `frontend/src/pages/PreprocessingPage.tsx`
- Modify: `frontend/src/components/routing/AppRouter.tsx`
- Delete: `frontend/src/pages/WASMPreprocessingPage.tsx`

- [ ] **Step 1: Update PreprocessingPage**

Remove the direct `import { api }` and use the store's DI-backed methods instead. The page should work identically in both modes — the store handles the mode difference via the injected service.

Remove the deep-link code that calls `api.screenshots.getById()` directly — route through the store or the service.

- [ ] **Step 2: Update AppRouter**

Change the preprocessing route from:
```typescript
{config.isLocalMode ? <WASMPreprocessingPage /> : <ServerPreprocessingPage />}
```
To:
```typescript
<PreprocessingPage />
```

- [ ] **Step 3: Delete WASMPreprocessingPage**

Remove `frontend/src/pages/WASMPreprocessingPage.tsx`.

- [ ] **Step 4: Commit**

```bash
git rm frontend/src/pages/WASMPreprocessingPage.tsx
git add frontend/src/pages/PreprocessingPage.tsx frontend/src/components/routing/AppRouter.tsx
git commit -m "feat: unify PreprocessingPage for both server and WASM modes"
```

---

## Chunk 4: WASM Processing Metadata + Image Pipeline

### Task 11: Processing Metadata Schema for WASM

**Files:**
- Modify: `frontend/src/core/implementations/wasm/storage/database/ScreenshotDB.ts` (if needed)

The WASM preprocessing service needs to store the same `processing_metadata.preprocessing` JSON structure that the server uses. The Screenshot type already has a `processing_metadata` field (it's in the API schema). In WASM mode this is stored as a JSON column in IndexedDB.

- [ ] **Step 1: Verify processing_metadata storage**

Check that IndexedDB `screenshots` table allows storing arbitrary JSON in `processing_metadata`. Dexie stores any JSON-serializable value, so this should work already.

- [ ] **Step 2: Create helper to initialize preprocessing metadata**

In `WASMPreprocessingService.ts`, add a helper:
```typescript
function initPreprocessingMetadata(screenshot: Screenshot): Record<string, unknown> {
  const existing = (screenshot.processing_metadata as Record<string, unknown>) ?? {};
  if (!existing.preprocessing) {
    existing.preprocessing = {
      stage_status: {
        device_detection: "pending",
        cropping: "pending",
        phi_detection: "pending",
        phi_redaction: "pending",
      },
      current_events: {
        device_detection: null,
        cropping: null,
        phi_detection: null,
        phi_redaction: null,
      },
      events: [],
    };
  }
  return existing;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts
git commit -m "feat: add preprocessing metadata initialization for WASM screenshots"
```

### Task 12: Image Blob Pipeline for Preprocessing

When cropping or redaction modifies an image, the WASM service needs to:
1. Load the current blob from OPFS
2. Run the stage (crop/redact produces a new blob)
3. Store the new blob back to OPFS (replacing the original)
4. Update the screenshot's `file_path` field if needed

- [ ] **Step 1: Implement blob read-process-write in WASMPreprocessingService**

For cropping stage:
```typescript
// Load current blob
const blob = await this.storageService.getImageBlob(screenshot.id);
// Run crop
const result = await cropScreenshot(blob, deviceInfo);
if (result.wasCropped) {
  // Store cropped blob (replaces original)
  await this.storageService.saveImageBlob(screenshot.id, result.croppedBlob);
}
```

Same pattern for PHI redaction.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts
git commit -m "feat: add blob pipeline for preprocessing stages"
```

---

## Verification Checklist

After all tasks are complete:

1. **Server mode unchanged**: PreprocessingPage works exactly as before in server mode
2. **WASM mode has all 4 stages**: Device detection, cropping, PHI detection, PHI redaction tabs all appear
3. **Device detection works**: Loads image dimensions, identifies iPhone/iPad, shows confidence
4. **Cropping works**: iPad screenshots get sidebar removed, image blob updated
5. **PHI detection works**: OCR + regex finds emails/phones/SSNs, displays regions
6. **PHI redaction works**: Red/black box or pixelate applied to detected regions
7. **Stage ordering enforced**: Can't run cropping before device detection, etc.
8. **Exception flagging works**: Unknown devices, uncropped iPads, detected PHI all flagged
9. **Event log works**: Each stage run creates events visible in the event log panel
10. **No consensus page in WASM**: Nav link hidden, route redirects to home
11. **Group deletion in WASM**: Trash icon visible, deletes all screenshots + blobs for group

---

## Notes

### PHI Detection Limitations in WASM

WASM mode uses regex-based detection instead of Presidio NER. This means:
- **Covered**: Email addresses, phone numbers, SSNs, dates, URLs
- **Not covered**: Person names (Presidio uses ML models for NER), medical record numbers (context-dependent)
- **No LLM support**: LLM options hidden in WASM mode (no server to call)
- This is acceptable because WASM mode is for local/offline use where PHI exposure is to the local user only

### Polling vs Synchronous

Server mode: stages run in Celery workers, store polls every 2s for completion.
WASM mode: stages run synchronously in the main thread (or Web Worker for OCR). The store's `runStage` returns after all processing is done, so `queued_count` reflects processed count and `running` is always 0 in the next summary — polling auto-stops immediately.

### Image Patching

The Python cropper includes bottom-patching for short iPad screenshots using bundled PNG assets. In WASM mode, skip patching and mark `was_patched: false`. This is acceptable because:
1. Most iPad screenshots are full-height
2. Patching is a cosmetic fix, not required for data extraction
3. Can be added later by bundling patch assets in the frontend build
