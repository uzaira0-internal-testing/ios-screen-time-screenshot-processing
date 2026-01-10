// Runtime configuration injected by docker-entrypoint.sh via config.js
declare global {
  interface Window {
    __CONFIG__?: { basePath?: string };
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
  get apiBaseUrl(): string {
    return `${this.basePath}/api/v1`;
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
