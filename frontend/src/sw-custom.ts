/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

// Force immediate activation - don't wait for tabs to close
self.addEventListener("install", (event) => {
  console.log("[SW] Installing new version...");
  // Skip waiting immediately to activate new SW
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activating new version...");
  // Take control of all clients immediately
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Notify all clients that a new version is active
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => {
        client.postMessage({ type: "SW_UPDATED" });
      });
      console.log("[SW] New version activated and clients notified");
    })(),
  );
});

// Workbox precaching
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Claim clients immediately (backup)
clientsClaim();

// Handle API upload requests
registerRoute(
  ({ url }) => url.pathname === "/api/screenshots/upload",
  async ({ request }) => {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await request.json();

      // Send message to client to process the upload
      const clients = await self.clients.matchAll({ type: "window" });

      if (clients.length === 0) {
        return new Response(
          JSON.stringify({ error: "No active client to process request" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Create a message channel for response
      const messageChannel = new MessageChannel();

      const responsePromise = new Promise<Response>((resolve) => {
        messageChannel.port1.onmessage = (event) => {
          if (event.data.error) {
            resolve(
              new Response(JSON.stringify({ error: event.data.error }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }),
            );
          } else {
            resolve(
              new Response(JSON.stringify(event.data), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
        };
      });

      // Send to first available client
      const client = clients[0];
      if (client) {
        client.postMessage({ type: "API_UPLOAD", payload: body }, [
          messageChannel.port2,
        ]);
      }

      return responsePromise;
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
  "POST",
);

// Handle API groups list
registerRoute(
  ({ url }) => url.pathname === "/api/groups",
  async ({ request }) => {
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const clients = await self.clients.matchAll({ type: "window" });

      if (clients.length === 0) {
        return new Response(JSON.stringify({ error: "No active client" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      const messageChannel = new MessageChannel();

      const responsePromise = new Promise<Response>((resolve) => {
        messageChannel.port1.onmessage = (event) => {
          if (event.data.error) {
            resolve(
              new Response(JSON.stringify({ error: event.data.error }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }),
            );
          } else {
            resolve(
              new Response(JSON.stringify(event.data), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
        };
      });

      const client = clients[0];
      if (client) {
        client.postMessage({ type: "API_GET_GROUPS" }, [messageChannel.port2]);
      }

      return responsePromise;
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
  "GET",
);
