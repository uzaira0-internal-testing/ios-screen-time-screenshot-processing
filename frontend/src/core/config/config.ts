/**
 * Application Configuration
 *
 * Supports dual-mode operation:
 * - Server mode: when apiBaseUrl is present in window.__CONFIG__
 * - WASM mode: when apiBaseUrl is absent (local-first, offline)
 */

import { config } from "@/config";

export type AppMode = "server" | "wasm";

export type ProcessingMode = AppMode;

export interface AppConfig {
  mode: ProcessingMode;
  apiBaseUrl?: string;
  features: {
    offlineMode: boolean;
    autoProcessing: boolean;
    exportToFile: boolean;
  };
}

/**
 * Detect application mode based on configuration.
 * If apiBaseUrl is present → server mode, otherwise → wasm mode.
 */
export function detectMode(): ProcessingMode {
  return config.hasApi ? "server" : "wasm";
}

/**
 * Creates application configuration based on detected mode.
 */
export function createConfig(): AppConfig {
  const mode = detectMode();

  if (mode === "wasm") {
    return {
      mode: "wasm",
      features: {
        offlineMode: true,
        autoProcessing: true,
        exportToFile: true,
      },
    };
  }

  return {
    mode: "server",
    apiBaseUrl: config.apiBaseUrl,
    features: {
      offlineMode: false,
      autoProcessing: true,
      exportToFile: false,
    },
  };
}
