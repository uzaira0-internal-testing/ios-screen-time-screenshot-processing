import { bootstrapWasmServices } from "./bootstrapWasm";
import type { AppConfig } from "../config";
import type { ServiceContainer } from "./Container";

/**
 * Bootstrap services for Tauri (desktop) mode.
 *
 * Phase 1: Reuses WASM services (IndexedDB + Tesseract.js).
 * Phase 2+: Swap in TauriStorageService (SQLite), native file access, Rust OCR.
 */
export function bootstrapTauriServices(config: AppConfig): ServiceContainer {
  return bootstrapWasmServices(config);
}
