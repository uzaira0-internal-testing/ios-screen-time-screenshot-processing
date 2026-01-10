/**
 * Application Configuration
 *
 * Provides configuration for the application based on detected environment
 * and user preferences. Uses the new environment detection system.
 */

import { environment, type AppMode } from "@/config/environment";

export type ProcessingMode = AppMode; // Alias for backward compatibility

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
 * Detects the current processing mode
 * @deprecated Use environment.mode from @/config/environment instead
 */
export function detectMode(): ProcessingMode {
  return environment.mode;
}

/**
 * Creates application configuration based on current environment
 */
export function createConfig(mode?: ProcessingMode): AppConfig {
  const effectiveMode = mode || environment.mode;

  return {
    mode: effectiveMode,
    apiBaseUrl: environment.apiBaseUrl || undefined,
    features: {
      offlineMode: effectiveMode === "wasm",
      autoProcessing: true,
      exportToFile: effectiveMode === "wasm",
    },
  };
}

/**
 * Sets the application mode
 * @deprecated Use setAppMode from @/config/environment instead
 */
export function setMode(mode: ProcessingMode): void {
  localStorage.setItem("app-mode", mode);
  window.location.reload();
}
