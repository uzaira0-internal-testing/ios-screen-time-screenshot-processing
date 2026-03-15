---
name: setup-wasm-worker
description: Creates a typed Web Worker for client-side processing, supporting both JS/TS and Rust-to-WASM paths. Generates worker file, message types, and promise-based service wrapper with progress reporting.
user_invocable: true
---

# Setup WASM Worker

This skill scaffolds a fully typed Web Worker for client-side processing. It supports two paths: pure JS/TS workers and Rust compiled to WASM loaded inside a worker.

## When Invoked

Ask the user the following questions before generating any code:

1. **JS/TS Worker or Rust WASM?**
   - JS/TS: Worker runs TypeScript/JavaScript directly. Best for DOM-adjacent logic, OCR wrappers, data transformation.
   - Rust WASM: Worker loads a `.wasm` module compiled from Rust via `wasm-pack`. Best for CPU-intensive computation (image processing, encoding, compression, cryptography).

2. **What processing does the worker perform?**
   - Get a short description of the task (e.g., "image grid detection", "CSV parsing", "OCR via Tesseract.js").
   - This determines the message types and payload shapes.

3. **What messages does the worker need?**
   - List the operations the worker must support (e.g., `INITIALIZE`, `PROCESS_IMAGE`, `DETECT_GRID`, `EXTRACT_TEXT`).
   - For each message: what data goes in (payload), what comes back (response), and whether it reports progress.

## Decision Framework: JS/TS vs Rust WASM

| Factor | JS/TS Worker | Rust WASM Worker |
|--------|-------------|------------------|
| **Setup complexity** | Low -- just a `.ts` file | High -- needs `wasm-pack`, Rust toolchain, `wasm-bindgen` |
| **Performance** | Good for I/O-bound, moderate compute | Excellent for CPU-bound, SIMD-eligible work |
| **Binary size** | Zero overhead | 50KB-2MB+ depending on dependencies |
| **Debugging** | Standard browser devtools | Source maps via `wasm-pack build --debug`, limited |
| **Library ecosystem** | Full npm access | Rust crates; no DOM/Web APIs without `web-sys`/`js-sys` |
| **Ideal for** | API wrappers, Tesseract.js, data transformation | Image processing, compression, hashing, physics |
| **Build pipeline** | Standard bundler (Vite, webpack) | `wasm-pack build --target web` + bundler plugin |
| **Memory management** | GC handles it | Manual via `wasm-bindgen`; must free allocations |

**Rule of thumb**: If the task is primarily calling a JS library (Tesseract.js, PDF.js) or doing data transformation, use JS/TS. If you are writing the algorithm yourself and it is CPU-intensive, use Rust WASM.

## Architecture (references Chapter 02)

```
src/core/implementations/wasm/
├── processing/
│   ├── workers/
│   │   ├── {name}.worker.ts          # The Web Worker entry point
│   │   └── {name}.types.ts           # Message and response type definitions
│   └── {Name}Service.ts              # Promise-based RPC wrapper
```

## Generated Files

### 1. Message Types (`{name}.types.ts`)

This file defines the typed message protocol between the main thread and the worker.

```typescript
// ============================================================
// Worker Message Protocol Types
// ============================================================

/**
 * Union of all payload types the main thread can send to the worker.
 * Extend this as new operations are added.
 */
export type WorkerMessagePayload =
  | InitializePayload
  | ProcessPayload;

/**
 * Union of all payload types the worker can send back.
 */
export type WorkerResponsePayload =
  | InitializeResult
  | ProcessResult;

// --- Inbound Payloads (main thread -> worker) ---

export interface InitializePayload {
  /** Path to WASM file or configuration URL */
  wasmUrl?: string;
  /** Any initialization options */
  options?: Record<string, unknown>;
}

export interface ProcessPayload {
  /**
   * Raw image data for zero-copy transfer.
   * The underlying ArrayBuffer is transferred (not copied) to the worker.
   */
  imageData: ImageData;
  /** Processing parameters */
  params?: Record<string, unknown>;
}

// --- Outbound Payloads (worker -> main thread) ---

export interface InitializeResult {
  ready: boolean;
  version?: string;
}

export interface ProcessResult {
  /** Processing output -- shape depends on the operation */
  data: unknown;
  /** Processing duration in milliseconds */
  elapsedMs: number;
}

// --- Message Envelope ---

/**
 * Every message between main thread and worker uses this envelope.
 * The `id` field correlates requests with responses for the RPC layer.
 */
export interface WorkerMessage {
  /** Operation type, e.g. "INITIALIZE", "PROCESS" */
  type: string;
  /** Unique message ID for correlating request/response pairs */
  id: string;
  /** Operation-specific payload */
  payload: WorkerMessagePayload;
}

export interface WorkerResponse {
  /** Echoes the request type, or "PROGRESS" / "ERROR" for out-of-band messages */
  type: string;
  /** Echoes the request ID */
  id: string;
  /** Response payload (absent on error) */
  payload?: WorkerResponsePayload;
  /** Error message (absent on success) */
  error?: string;
}

/**
 * Progress reports are sent with type "PROGRESS" and the originating message ID.
 * The service wrapper routes these to the onProgress callback.
 */
export interface WorkerProgress {
  type: "PROGRESS";
  id: string;
  /** 0-100 */
  percent: number;
  /** Human-readable status message */
  message?: string;
}
```

### 2. Worker Entry Point (`{name}.worker.ts`)

#### JS/TS Variant

```typescript
import type {
  WorkerMessage,
  WorkerResponse,
  WorkerProgress,
  InitializePayload,
  ProcessPayload,
} from "./{name}.types";

// ============================================================
// Worker State
// ============================================================

let initialized = false;

// ============================================================
// Message Router
// ============================================================

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, id, payload } = event.data;

  try {
    switch (type) {
      case "INITIALIZE":
        await handleInitialize(id, payload as InitializePayload);
        break;
      case "PROCESS":
        await handleProcess(id, payload as ProcessPayload);
        break;
      default:
        respond(id, type, undefined, `Unknown message type: ${type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    respond(id, type, undefined, message);
  }
};

// ============================================================
// Handlers
// ============================================================

async function handleInitialize(
  id: string,
  payload: InitializePayload,
): Promise<void> {
  reportProgress(id, 0, "Initializing...");

  // TODO: Load libraries, WASM modules, models, etc.
  // Example: await loadTesseract(payload.wasmUrl);

  reportProgress(id, 100, "Ready");
  initialized = true;
  respond(id, "INITIALIZE", { ready: true });
}

async function handleProcess(
  id: string,
  payload: ProcessPayload,
): Promise<void> {
  if (!initialized) {
    respond(id, "PROCESS", undefined, "Worker not initialized");
    return;
  }

  const start = performance.now();
  reportProgress(id, 0, "Starting processing...");

  // TODO: Implement actual processing logic here.
  // The payload.imageData ArrayBuffer has been transferred (zero-copy).
  // After processing, transfer result buffers back if applicable.

  reportProgress(id, 50, "Processing...");

  // Placeholder result
  const result = { data: null, elapsedMs: performance.now() - start };

  reportProgress(id, 100, "Complete");
  respond(id, "PROCESS", result);
}

// ============================================================
// Helpers
// ============================================================

function respond(
  id: string,
  type: string,
  payload?: unknown,
  error?: string,
): void {
  const response: WorkerResponse = { type, id };
  if (payload !== undefined) response.payload = payload as any;
  if (error !== undefined) response.error = error;
  self.postMessage(response);
}

function reportProgress(
  id: string,
  percent: number,
  message?: string,
): void {
  const progress: WorkerProgress = { type: "PROGRESS", id, percent };
  if (message) progress.message = message;
  self.postMessage(progress);
}
```

#### Rust WASM Variant

When the user picks Rust WASM, the worker file loads the `.wasm` module via `wasm-pack` output:

```typescript
import type {
  WorkerMessage,
  WorkerResponse,
  WorkerProgress,
  InitializePayload,
  ProcessPayload,
} from "./{name}.types";

// ============================================================
// Worker State
// ============================================================

let wasmModule: typeof import("path/to/pkg") | null = null;
let initialized = false;

// ============================================================
// Message Router
// ============================================================

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, id, payload } = event.data;

  try {
    switch (type) {
      case "INITIALIZE":
        await handleInitialize(id, payload as InitializePayload);
        break;
      case "PROCESS":
        await handleProcess(id, payload as ProcessPayload);
        break;
      default:
        respond(id, type, undefined, `Unknown message type: ${type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    respond(id, type, undefined, message);
  }
};

// ============================================================
// Handlers
// ============================================================

async function handleInitialize(
  id: string,
  _payload: InitializePayload,
): Promise<void> {
  reportProgress(id, 0, "Loading WASM module...");

  // Dynamic import of wasm-pack output
  // The bundler (Vite with vite-plugin-wasm) resolves this at build time
  const wasm = await import("path/to/pkg");
  await wasm.default(); // Initialize the WASM module (calls __wbg_init)
  wasmModule = wasm;

  reportProgress(id, 100, "WASM module loaded");
  initialized = true;
  respond(id, "INITIALIZE", { ready: true, version: wasm.version?.() });
}

async function handleProcess(
  id: string,
  payload: ProcessPayload,
): Promise<void> {
  if (!initialized || !wasmModule) {
    respond(id, "PROCESS", undefined, "Worker not initialized");
    return;
  }

  const start = performance.now();
  reportProgress(id, 0, "Starting WASM processing...");

  // Convert ImageData to Uint8Array for WASM consumption
  const inputBytes = new Uint8Array(payload.imageData.data.buffer);

  // Call the Rust function exposed via wasm-bindgen
  // TODO: Replace with actual exported function name
  const resultBytes = wasmModule.process(
    inputBytes,
    payload.imageData.width,
    payload.imageData.height,
  );

  reportProgress(id, 100, "Complete");
  respond(id, "PROCESS", {
    data: resultBytes,
    elapsedMs: performance.now() - start,
  });
}

// ============================================================
// Helpers (same as JS/TS variant)
// ============================================================

function respond(
  id: string,
  type: string,
  payload?: unknown,
  error?: string,
): void {
  const response: WorkerResponse = { type, id };
  if (payload !== undefined) response.payload = payload as any;
  if (error !== undefined) response.error = error;
  self.postMessage(response);
}

function reportProgress(
  id: string,
  percent: number,
  message?: string,
): void {
  const progress: WorkerProgress = { type: "PROGRESS", id, percent };
  if (message) progress.message = message;
  self.postMessage(progress);
}
```

### 3. Service Wrapper (`{Name}Service.ts`)

This class provides a promise-based RPC interface over the raw `postMessage` API. It handles message correlation, timeouts, progress callbacks, and zero-copy `Transferable` detection.

```typescript
import type {
  WorkerMessage,
  WorkerResponse,
  WorkerProgress,
  WorkerMessagePayload,
  WorkerResponsePayload,
} from "./workers/{name}.types";

// ============================================================
// Pending Request Tracking
// ============================================================

interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  onProgress?: (percent: number, message?: string) => void;
}

// ============================================================
// Service Class
// ============================================================

export class ProcessingService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private messageIdCounter = 0;
  private initialized = false;

  // ----------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------

  /**
   * Create the worker and initialize it.
   * Call this once before any processing calls.
   */
  async initialize(options?: Record<string, unknown>): Promise<void> {
    if (this.initialized) return;

    // Vite worker import syntax -- the ?worker suffix tells Vite to emit
    // the file as a separate chunk and return a Worker constructor.
    const WorkerConstructor = (
      await import("./workers/{name}.worker?worker")
    ).default;
    this.worker = new WorkerConstructor();
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);

    await this.sendMessage<{ ready: boolean }>({
      type: "INITIALIZE",
      payload: { options } as WorkerMessagePayload,
    });

    this.initialized = true;
  }

  /**
   * Terminate the worker and reject all pending requests.
   * Safe to call multiple times.
   */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.initialized = false;
    this.pendingRequests.forEach((req) =>
      req.reject(new Error("Worker terminated")),
    );
    this.pendingRequests.clear();
  }

  // ----------------------------------------------------------
  // Public API (add domain-specific methods here)
  // ----------------------------------------------------------

  /**
   * Example: process an image and report progress.
   */
  async process(
    imageData: ImageData,
    params?: Record<string, unknown>,
    onProgress?: (percent: number, message?: string) => void,
  ): Promise<unknown> {
    return this.sendMessage(
      {
        type: "PROCESS",
        payload: { imageData, params } as WorkerMessagePayload,
      },
      onProgress,
    );
  }

  // ----------------------------------------------------------
  // RPC Layer
  // ----------------------------------------------------------

  private generateMessageId(): string {
    return `msg_${++this.messageIdCounter}_${Date.now()}`;
  }

  private async sendMessage<T>(
    message: Omit<WorkerMessage, "id">,
    onProgress?: (percent: number, message?: string) => void,
  ): Promise<T> {
    if (!this.worker) {
      throw new Error("Worker not initialized. Call initialize() first.");
    }

    const id = this.generateMessageId();
    const fullMessage: WorkerMessage = { ...message, id };

    return new Promise<T>((resolve, reject) => {
      // Timeouts: initialization gets longer, operations get standard timeout
      const timeoutMs = message.type === "INITIALIZE" ? 120_000 : 60_000;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `Worker message ${message.type} timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        onProgress,
      });

      // Collect transferable ArrayBuffers for zero-copy transfer.
      // This avoids copying large image buffers between threads.
      const transferables: Transferable[] = [];
      const payload = message.payload as Record<string, any> | undefined;
      if (payload?.imageData?.data?.buffer instanceof ArrayBuffer) {
        transferables.push(payload.imageData.data.buffer);
      }

      this.worker!.postMessage(fullMessage, transferables);
    });
  }

  // ----------------------------------------------------------
  // Message Handling
  // ----------------------------------------------------------

  private handleMessage(event: MessageEvent<WorkerResponse | WorkerProgress>): void {
    const data = event.data;

    // Route progress reports to the onProgress callback
    if (data.type === "PROGRESS") {
      const progress = data as WorkerProgress;
      const pending = this.pendingRequests.get(progress.id);
      pending?.onProgress?.(progress.percent, progress.message);
      return;
    }

    // Route responses to the pending promise
    const response = data as WorkerResponse;
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return; // Stale or duplicate response

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.payload);
    }
  }

  private handleError(event: ErrorEvent): void {
    console.error("[ProcessingService] Worker error:", event.message);
    // Reject all pending requests on unrecoverable worker error
    this.pendingRequests.forEach((req) =>
      req.reject(new Error(`Worker error: ${event.message}`)),
    );
    this.pendingRequests.clear();
  }
}
```

## CSP Requirements

When deploying an app that uses Web Workers (especially with WASM), the following Content-Security-Policy headers are required:

```
Content-Security-Policy:
  worker-src 'self' blob:;
  script-src 'self' 'wasm-unsafe-eval';
```

| Directive | Why |
|-----------|-----|
| `worker-src 'self' blob:` | Vite emits workers as blob URLs in dev mode; production uses same-origin URLs |
| `script-src 'wasm-unsafe-eval'` | Required for `WebAssembly.instantiate()`. This is the narrowest CSP directive for WASM -- do NOT use `'unsafe-eval'` |

For nginx, add these in the `location` block or `server` block:

```nginx
add_header Content-Security-Policy "default-src 'self'; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval';" always;
```

## Vite Configuration

For Rust WASM workers, install the Vite WASM plugin:

```bash
bun add -D vite-plugin-wasm vite-plugin-top-level-await
```

```typescript
// vite.config.ts
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()],
  },
});
```

## Rust WASM Setup (if applicable)

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Create a new Rust library
cargo init --lib wasm/{name}

# Build for web target
cd wasm/{name} && wasm-pack build --target web --release
```

Minimal `Cargo.toml`:

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
web-sys = { version = "0.3", features = ["console"] }

[profile.release]
opt-level = "s"     # Optimize for size
lto = true
```

Minimal `lib.rs`:

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn process(data: &[u8], width: u32, height: u32) -> Vec<u8> {
    // TODO: Implement processing
    data.to_vec()
}
```

## Testing Workers

- **Unit test the processing logic** by extracting it into pure functions that can be imported outside the worker context. The worker file should be a thin message-routing shell.
- **Integration test with Playwright**: spawn the app, trigger the worker operation, and assert on the result in the UI.
- **Direct function import**: In test files, import the processing functions directly (not the worker). Workers cannot be instantiated in Node/Bun test runners without polyfills.

## Common Pitfalls

1. **Forgetting to transfer ArrayBuffers**: Without the `transferables` array, large buffers are copied (slow). After transfer, the buffer is neutered on the sender side -- do not access it after `postMessage`.
2. **WASM memory limits**: The default WASM linear memory is 256 pages (16MB). For image processing, set initial memory higher in `Cargo.toml` or use `wasm-bindgen`'s memory growth.
3. **Stale worker after HMR**: Vite HMR does not update workers. During development, call `terminate()` and re-initialize when the module reloads.
4. **SharedArrayBuffer**: Requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. Only use if you genuinely need shared memory between threads.
