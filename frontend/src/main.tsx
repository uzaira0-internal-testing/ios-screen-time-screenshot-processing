import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { ServiceProvider } from "./core";

// NOTE: PWA/Service Worker functionality removed - not supported by Bun bundler.
// The build uses Bun.build() which doesn't support vite-plugin-pwa virtual modules.
// To re-enable PWA, switch to Vite bundler or implement workbox-cli manually.

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Failed to find the root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ServiceProvider>
      <App />
    </ServiceProvider>
  </React.StrictMode>,
);

// force rebuild 1768038003
