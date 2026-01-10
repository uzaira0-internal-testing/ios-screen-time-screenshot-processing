/**
 * Application Configuration (Server Mode Only)
 *
 * WASM mode has been archived. This app runs in server mode exclusively.
 */

import { environment, type AppMode } from "@/config/environment";

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
 * @deprecated Use environment.mode directly
 */
export function detectMode(): ProcessingMode {
  return "server";
}

/**
 * Creates application configuration for server mode
 */
export function createConfig(): AppConfig {
  return {
    mode: "server",
    apiBaseUrl: environment.apiBaseUrl || undefined,
    features: {
      offlineMode: false,
      autoProcessing: true,
      exportToFile: false,
    },
  };
}

/**
 * @deprecated Mode switching is no longer supported
 */
export function setMode(): void {
  console.warn("Mode switching is no longer supported. App runs in server mode only.");
}
