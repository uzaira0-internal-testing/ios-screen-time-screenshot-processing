# Processing Settings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Processing Settings section to SettingsPage with 4 user-configurable options, fix the hardcoded version display, and fix the login page defaulting to online.

**Architecture:** Create a `settingsStore` (Zustand + localStorage) for processing preferences. The store is read by the preprocessing store when running stages and by WASMScreenshotService for auto-process/skip-daily behavior. SettingsPage gets a new "Processing" card with the 4 settings.

**Tech Stack:** Zustand, localStorage, React, TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/store/settingsStore.ts` | **Create** | Zustand store with localStorage persistence for processing settings |
| `frontend/src/pages/SettingsPage.tsx` | **Modify** | Add Processing section, fix version display |
| `frontend/src/store/preprocessingStore.ts` | **Modify** | Read `ocrMethod` and `maxShift` from settingsStore instead of local state |
| `frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts` | **Modify** | Read `skipDailyTotals` setting; use `maxShift` from options |
| `frontend/src/core/implementations/wasm/WASMScreenshotService.ts` | **Modify** | Read `autoProcessOnUpload` setting in upload flow |
| `frontend/src/core/interfaces/IPreprocessingService.ts` | **Modify** | Add `max_shift` to `RunStageOptions` |
| `frontend/src/components/auth/LoginForm.tsx` | **Modify** | Don't auto-check "Connect to Server" from saved config |
| `frontend/src/config.ts` | **Modify** | Add `appVersion` getter |
| `frontend/package.json` | **Modify** | Sync version with tauri.conf.json |

---

## Task 1: Create settingsStore

**Files:**
- Create: `frontend/src/store/settingsStore.ts`

- [ ] **Step 1: Create the store**

```typescript
import { create } from "zustand";

export interface ProcessingSettings {
  /** Auto-skip daily total screenshots during preprocessing */
  skipDailyTotals: boolean;
  /** Default grid detection method */
  gridDetectionMethod: "line_based" | "ocr_anchored";
  /** Boundary optimizer max pixel shift (0 = disabled) */
  maxShift: number;
  /** Auto-run OCR processing when screenshots are uploaded */
  autoProcessOnUpload: boolean;
}

const STORAGE_KEY = "processing-settings";

const DEFAULTS: ProcessingSettings = {
  skipDailyTotals: false,
  gridDetectionMethod: "line_based",
  maxShift: 5,
  autoProcessOnUpload: false,
};

function loadFromStorage(): ProcessingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function saveToStorage(settings: ProcessingSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface SettingsState extends ProcessingSettings {
  set: <K extends keyof ProcessingSettings>(key: K, value: ProcessingSettings[K]) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...loadFromStorage(),
  set: (key, value) =>
    set((state) => {
      const updated = { ...state, [key]: value };
      saveToStorage({
        skipDailyTotals: updated.skipDailyTotals,
        gridDetectionMethod: updated.gridDetectionMethod,
        maxShift: updated.maxShift,
        autoProcessOnUpload: updated.autoProcessOnUpload,
      });
      return { [key]: value };
    }),
  reset: () => {
    saveToStorage(DEFAULTS);
    set(DEFAULTS);
  },
}));
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/settingsStore.ts
git commit -m "feat: add processing settings store with localStorage persistence"
```

---

## Task 2: Add Processing section to SettingsPage + fix version + fix login

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/components/auth/LoginForm.tsx`
- Modify: `frontend/src/config.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Update package.json version**

Change `"version": "1.0.0"` to match current tauri.conf.json version (e.g., `"0.3.27"`).

- [ ] **Step 2: Add appVersion to config.ts**

Add to the `config` object:

```typescript
get appVersion(): string {
  return __APP_VERSION__;
},
```

And add the global declaration at the top:

```typescript
declare const __APP_VERSION__: string;
```

This uses Vite's `define` feature. Add to `vite.config.ts`:

```typescript
define: {
  __APP_VERSION__: JSON.stringify(require('./package.json').version),
}
```

If vite.config doesn't support require, use a simpler approach: just import version from package.json in config.ts:

```typescript
import packageJson from "../package.json";
// ...
get appVersion(): string {
  return packageJson.version;
},
```

- [ ] **Step 3: Add Processing section to SettingsPage**

Import at top of SettingsPage.tsx:

```typescript
import { useSettingsStore } from "@/store/settingsStore";
import { Sliders } from "lucide-react";
```

Add a `ProcessingSection` component before the About section. It renders 4 settings:

1. **Skip Daily Total Images** — Toggle. Description: "Automatically skip daily total screenshots during preprocessing"
2. **Grid Detection Method** — Two buttons: "Line-Based" / "OCR-Anchored". Description: "Method used to detect the graph grid boundaries"
3. **Boundary Optimizer** — Three buttons: "Off" (0) / "Normal" (5) / "Aggressive" (10). Description: "How aggressively to optimize grid alignment with OCR total"
4. **Auto-Process on Upload** — Toggle. Description: "Automatically run OCR processing when screenshots are uploaded"

Pattern: follow the existing Theme section's button group style for method/optimizer, and the Toggle component for booleans.

- [ ] **Step 4: Fix version display in About section**

Replace:
```tsx
<strong>Version:</strong> 1.0.0
```
With:
```tsx
<strong>Version:</strong> {config.appVersion}
```

- [ ] **Step 5: Fix LoginForm — don't auto-check Connect to Server**

In `frontend/src/components/auth/LoginForm.tsx`, the useEffect on lines 42-51 auto-enables `connectToServer` if there's a saved URL. Remove the `setConnectToServer(true)` line so it just pre-fills the fields but doesn't auto-check the toggle:

Change:
```typescript
if (savedUrl) {
  setConnectToServer(true);
  setServerUrl(savedUrl);
  setSitePassword(savedPw);
}
```
To:
```typescript
if (savedUrl) {
  setServerUrl(savedUrl);
  setSitePassword(savedPw);
}
```

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/components/auth/LoginForm.tsx frontend/src/config.ts frontend/package.json
git commit -m "feat: add processing settings UI, fix version display, fix login default"
```

---

## Task 3: Wire settings into preprocessing pipeline

**Files:**
- Modify: `frontend/src/store/preprocessingStore.ts`
- Modify: `frontend/src/core/interfaces/IPreprocessingService.ts`
- Modify: `frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts`

- [ ] **Step 1: Add max_shift and skip_daily to RunStageOptions**

In `IPreprocessingService.ts`, add to `RunStageOptions`:

```typescript
max_shift?: number;
skip_daily_totals?: boolean;
```

- [ ] **Step 2: Read settings in preprocessingStore.runStage**

In `preprocessingStore.ts`, import and use settingsStore:

```typescript
import { useSettingsStore } from "@/store/settingsStore";
```

In the `runStage` method, replace the hardcoded `ocrMethod` state with settingsStore values:

```typescript
if (stage === "ocr") {
  const settings = useSettingsStore.getState();
  options.ocr_method = settings.gridDetectionMethod;
  options.max_shift = settings.maxShift;
  options.skip_daily_totals = settings.skipDailyTotals;
}
```

Remove `ocrMethod` from the preprocessingStore state/actions entirely (it's now in settingsStore). Update the PreprocessingPage's OCR method radio buttons to read/write from settingsStore instead.

- [ ] **Step 3: Use max_shift in WASMPreprocessingService OCR stage**

In `WASMPreprocessingService.ts`, change the hardcoded `maxShift: 5` to read from options:

```typescript
// Before:
maxShift: 5,
// After:
maxShift: options.max_shift ?? 5,
```

- [ ] **Step 4: Add skip-daily logic in WASMPreprocessingService OCR stage**

In the OCR case, after getting the `ocrResult`, check if it's a daily total and settings say to skip:

```typescript
if (options.skip_daily_totals && ocrResult.title === "Daily Total") {
  await this.storage.updateScreenshot(id, {
    processing_metadata: setPreprocessing(screenshot, updated),
    extracted_title: "Daily Total",
    processing_status: "skipped",
    processed_at: new Date().toISOString(),
  } as Partial<Screenshot>);
  break;
}
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/preprocessingStore.ts frontend/src/core/interfaces/IPreprocessingService.ts frontend/src/core/implementations/wasm/preprocessing/WASMPreprocessingService.ts
git commit -m "feat: wire processing settings into preprocessing pipeline"
```

---

## Task 4: Wire auto-process on upload

**Files:**
- Modify: `frontend/src/core/implementations/wasm/WASMScreenshotService.ts`

- [ ] **Step 1: Add auto-process after upload**

In `WASMScreenshotService.ts`, in the `upload` method (or wherever screenshots are saved after upload), check the setting and trigger processing:

```typescript
import { useSettingsStore } from "@/store/settingsStore";

// After saving the screenshot to IndexedDB:
if (useSettingsStore.getState().autoProcessOnUpload) {
  // Fire-and-forget — process in background
  this.processIfNeeded(screenshotData as Screenshot).catch((err) =>
    console.warn("[WASMScreenshotService] Auto-process failed:", err)
  );
}
```

Note: `processIfNeeded` already handles all the grid detection + OCR logic, so just calling it is sufficient.

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/implementations/wasm/WASMScreenshotService.ts
git commit -m "feat: auto-process screenshots on upload when enabled in settings"
```

---

## Task 5: Remove ocrMethod from PreprocessingPage (now in Settings)

**Files:**
- Modify: `frontend/src/pages/PreprocessingPage.tsx`

- [ ] **Step 1: Replace ocrMethod radio buttons**

The OCR method radio buttons on the PreprocessingPage should read/write from `useSettingsStore` instead of the preprocessing store. Import `useSettingsStore` and replace:

```typescript
const { gridDetectionMethod } = useSettingsStore();
const setGridDetectionMethod = (method: "line_based" | "ocr_anchored") =>
  useSettingsStore.getState().set("gridDetectionMethod", method);
```

Update the radio button `checked` and `onChange` to use these.

Alternatively, remove the radio buttons entirely from PreprocessingPage since they're now in Settings. Add a small note: "Grid detection method can be changed in Settings."

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PreprocessingPage.tsx
git commit -m "feat: move OCR method selection to settings page"
```

---

## Task 6: Bump version and deploy

- [ ] **Step 1: Bump tauri.conf.json version**

- [ ] **Step 2: Push + tag for Tauri build**

```bash
git push origin main
git tag tauri-v0.3.28
git push origin tauri-v0.3.28
```

---

## Verification

1. **Settings persistence**: Change settings, reload page, verify they persist
2. **Skip daily totals**: Enable setting, run OCR preprocessing on a group with daily total screenshots, verify they get status "skipped"
3. **Grid detection method**: Change to "ocr_anchored" in settings, run OCR, verify it uses the correct method
4. **Boundary optimizer**: Set to "Off" (0), run OCR, verify no optimization. Set to "Aggressive" (10), verify wider search
5. **Auto-process on upload**: Enable, upload a screenshot, verify it auto-processes without manual preprocessing
6. **Version display**: Settings → About shows correct version (e.g., "0.3.28"), not "1.0.0"
7. **Login page**: Open login in Tauri/local mode, verify "Connect to Server" is unchecked even if previously configured
