import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { ServiceProvider } from "./core";
import { registerSW } from "virtual:pwa-register";
import { showUpdateNotification } from "./components/pwa/UpdateNotification";

// Check for updates every 60 seconds
const UPDATE_CHECK_INTERVAL = 60 * 1000;

// Listen for SW_UPDATED message from service worker to force reload
// Only enable auto-reload in production to avoid issues during development/testing
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_UPDATED") {
      console.log("[SW] Received update notification, reloading page...");
      // Give a brief moment for any pending operations, then reload
      setTimeout(() => {
        window.location.reload();
      }, 100);
    }
  });
}

const updateSW = registerSW({
  immediate: true, // Check for updates immediately on load
  onNeedRefresh() {
    console.log("[SW] New version detected, showing update notification");
    showUpdateNotification(() => {
      console.log("[SW] User accepted update, reloading...");
      updateSW(true);
    });
  },
  onOfflineReady() {
    console.log("[SW] App ready to work offline");
  },
  onRegistered(registration) {
    console.log("[SW] Service Worker registered:", registration);

    // Immediately check for updates
    if (registration) {
      registration.update().catch(console.error);

      // Then check periodically
      setInterval(() => {
        console.log("[SW] Checking for updates...");
        registration.update().catch(console.error);
      }, UPDATE_CHECK_INTERVAL);
    }
  },
  onRegisterError(error) {
    console.error("[SW] Service Worker registration failed:", error);
  },
});

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
