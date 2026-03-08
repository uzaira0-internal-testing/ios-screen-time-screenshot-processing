// Runtime configuration injected by docker-entrypoint.sh via config.js
declare global {
  interface Window {
    __CONFIG__?: { basePath?: string; apiBaseUrl?: string };
  }
}

// Check if we're in development mode
// In production builds, Bun replaces process.env.NODE_ENV with "production"
const isDev =
  typeof process !== "undefined" &&
  process.env?.NODE_ENV !== "production";

export const config = {
  get basePath(): string {
    return window.__CONFIG__?.basePath || "";
  },
  /** Whether an API backend is available (server mode vs WASM mode) */
  get hasApi(): boolean {
    return !!window.__CONFIG__?.apiBaseUrl;
  },
  get apiBaseUrl(): string {
    // In server mode, apiBaseUrl is explicitly set in window.__CONFIG__
    // In WASM mode, falls back to basePath-derived URL (used by server-mode components only)
    return window.__CONFIG__?.apiBaseUrl ?? `${this.basePath}/api/v1`;
  },
  get wsUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}${this.basePath}/api/ws`;
  },
  get isDev(): boolean {
    return isDev;
  },
  get isProd(): boolean {
    return !isDev;
  },
};
