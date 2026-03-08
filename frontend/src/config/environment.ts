/**
 * Environment Configuration Module
 *
 * Supports dual-mode: server (with API) or wasm (local-first).
 */

import { config } from "@/config";

export type AppMode = "server" | "wasm";

export interface EnvironmentConfig {
  /** Current application mode */
  mode: AppMode;

  /** API base URL (null in WASM mode) */
  apiBaseUrl: string | null;

  /** Whether server mode is available */
  serverAvailable: boolean;
}

/**
 * Creates the environment configuration object.
 * Mode is determined by presence of apiBaseUrl.
 */
export function createEnvironmentConfig(): EnvironmentConfig {
  const apiBaseUrl = config.apiBaseUrl;
  const mode: AppMode = apiBaseUrl ? "server" : "wasm";

  return {
    mode,
    apiBaseUrl,
    serverAvailable: !!apiBaseUrl,
  };
}

export const environment = createEnvironmentConfig();
