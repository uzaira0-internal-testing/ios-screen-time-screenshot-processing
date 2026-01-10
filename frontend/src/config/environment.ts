/**
 * Environment Configuration Module (Server Mode Only)
 *
 * WASM mode has been archived. This app runs in server mode exclusively.
 */

import { config } from "@/config";

export type AppMode = "server";

export interface EnvironmentConfig {
  /** Current application mode (always server) */
  mode: AppMode;

  /** API base URL */
  apiBaseUrl: string | null;

  /** Whether server mode is available (always true) */
  serverAvailable: boolean;
}

/**
 * Creates the environment configuration object
 */
export function createEnvironmentConfig(): EnvironmentConfig {
  return {
    mode: "server",
    apiBaseUrl: config.apiBaseUrl,
    serverAvailable: true,
  };
}

/**
 * Gets the current environment configuration
 */
export const environment = createEnvironmentConfig();
