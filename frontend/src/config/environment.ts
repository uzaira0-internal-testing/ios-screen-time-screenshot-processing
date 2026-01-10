/**
 * Environment Configuration Module
 *
 * Detects runtime environment and determines application mode
 * based on environment variables and user preferences.
 */

import { config } from "@/config";

export type AppMode = "wasm" | "server";

export interface EnvironmentConfig {
  /** Current application mode */
  mode: AppMode;

  /** API base URL (only used in server mode) */
  apiBaseUrl: string | null;

  /** Whether server mode is available */
  serverAvailable: boolean;

  /** Whether WASM mode is available */
  wasmAvailable: boolean;

  /** Can the user switch modes? */
  canSwitchMode: boolean;
}

/**
 * Detects if the server mode is available based on runtime config
 * Server mode is available if basePath is configured (non-empty)
 */
export function isServerAvailable(): boolean {
  // In production with Docker, basePath will be set by docker-entrypoint.sh
  // In development, you can set it in config.js or it defaults to empty
  // An empty basePath means local dev without Docker (still server mode)
  // We detect server mode by checking if we're NOT in WASM-only mode
  // For now, always return true since this app is server-first
  return true;
}

/**
 * Detects if WASM mode is available (always true unless explicitly disabled)
 */
export function isWasmAvailable(): boolean {
  // Check if WebAssembly is supported
  try {
    if (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.instantiate === "function"
    ) {
      const module = new WebAssembly.Module(
        Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00),
      );
      if (module instanceof WebAssembly.Module) {
        return new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
      }
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * Gets the default mode based on environment and user preference
 */
export function getDefaultMode(): AppMode {
  // Check localStorage for user preference
  const storedMode = localStorage.getItem("app-mode");
  if (storedMode === "wasm" || storedMode === "server") {
    // Validate that the stored mode is still available
    if (storedMode === "server" && !isServerAvailable()) {
      localStorage.removeItem("app-mode");
      return "wasm"; // Fallback to WASM if server is no longer available
    }
    return storedMode;
  }

  // Default to server mode if API is configured, otherwise WASM
  if (isServerAvailable()) {
    return "server";
  }
  return "wasm";
}

/**
 * Creates the environment configuration object
 */
export function createEnvironmentConfig(): EnvironmentConfig {
  const serverAvailable = isServerAvailable();
  const wasmAvailable = isWasmAvailable();
  const defaultMode = getDefaultMode();

  return {
    mode: defaultMode,
    apiBaseUrl: serverAvailable ? config.apiBaseUrl : null,
    serverAvailable,
    wasmAvailable,
    canSwitchMode: serverAvailable && wasmAvailable,
  };
}

/**
 * Sets the application mode and persists to localStorage
 */
export function setAppMode(mode: AppMode): void {
  const config = createEnvironmentConfig();

  // Validate mode is available
  if (mode === "server" && !config.serverAvailable) {
    throw new Error(
      "Server mode is not available. VITE_API_BASE_URL is not configured.",
    );
  }

  if (mode === "wasm" && !config.wasmAvailable) {
    throw new Error(
      "WASM mode is not available. WebAssembly is not supported in this browser.",
    );
  }

  localStorage.setItem("app-mode", mode);

  // Reload to apply new mode
  window.location.reload();
}

/**
 * Gets the current environment configuration
 */
export const environment = createEnvironmentConfig();
