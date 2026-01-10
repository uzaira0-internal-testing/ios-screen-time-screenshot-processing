import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import toast from "react-hot-toast";
import { AppRouter } from "./components/routing/AppRouter";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAuthStore } from "./store/authStore";
import { useMode } from "./hooks/useMode";
import { OfflineBanner } from "./components/pwa/OfflineBanner";
import { Onboarding } from "./components/pwa/Onboarding";
import { InitializationScreen } from "./components/common/InitializationScreen";
import { preloadTesseract } from "./core/implementations/wasm/lazyLoad";
import { initAPIMessageHandler } from "./core/implementations/wasm/APIMessageHandler";
import { config } from "./config";
import type {
  AnnotationSubmittedEvent,
  ScreenshotCompletedEvent,
  UserJoinedEvent,
  UserLeftEvent,
} from "./types/websocket";

/**
 * WebSocket integration component (only for server mode)
 */
function WebSocketIntegration() {
  const { subscribe } = useWebSocket();
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) return;

    const unsubscribeAnnotationSubmitted = subscribe(
      "annotation_submitted",
      (data: AnnotationSubmittedEvent) => {
        toast.success(
          `${data.username} submitted annotation (${data.annotation_count}/${data.required_count})`,
          { duration: 4000 },
        );
      },
    );

    // Consensus UI hidden - backend still calculates but we don't show notifications
    // const unsubscribeConsensusDisputed = subscribe(
    //   "consensus_disputed",
    //   (data: ConsensusDisputedEvent) => {
    //     toast.error(
    //       `Disagreement detected in ${data.filename} (${data.disagreement_count} issues)`,
    //       { duration: 5000 },
    //     );
    //   },
    // );
    const unsubscribeConsensusDisputed = () => {}; // No-op

    const unsubscribeScreenshotCompleted = subscribe(
      "screenshot_completed",
      (data: ScreenshotCompletedEvent) => {
        toast.success(`Screenshot "${data.filename}" completed!`, {
          duration: 4000,
        });
      },
    );

    const unsubscribeUserJoined = subscribe(
      "user_joined",
      (data: UserJoinedEvent) => {
        toast(`${data.username} joined (${data.active_users} online)`, {
          icon: "👋",
          duration: 3000,
        });
      },
    );

    const unsubscribeUserLeft = subscribe(
      "user_left",
      (data: UserLeftEvent) => {
        toast(`${data.username} left (${data.active_users} online)`, {
          icon: "👋",
          duration: 3000,
        });
      },
    );

    return () => {
      unsubscribeAnnotationSubmitted();
      unsubscribeConsensusDisputed();
      unsubscribeScreenshotCompleted();
      unsubscribeUserJoined();
      unsubscribeUserLeft();
    };
  }, [subscribe, isAuthenticated]);

  return null;
}

/**
 * Main App Component
 *
 * Wraps the application with:
 * - ServiceProvider (Dependency Injection)
 * - BrowserRouter (Routing)
 * - Mode-aware features (WebSocket only in server mode)
 * - Tesseract preloading (WASM mode only)
 */
function App() {
  const { mode } = useMode();
  const [isInitializing, setIsInitializing] = useState(false);
  const [initProgress, setInitProgress] = useState(0);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    async function initialize() {
      // Only preload Tesseract in WASM mode
      if (mode !== "wasm") {
        return;
      }

      setIsInitializing(true);

      // Initialize API message handler for Service Worker communication
      initAPIMessageHandler();

      try {
        await preloadTesseract((progress, message) => {
          setInitProgress(progress);
          console.log(`[App] Tesseract preload: ${progress}% - ${message}`);
        });

        console.log("[App] Tesseract preload complete");
        setIsInitializing(false);
      } catch (error: any) {
        console.error("[App] Tesseract preload failed:", error);
        setInitError(
          error.message ||
            "Failed to initialize OCR engine. Please refresh the page.",
        );
        // Don't block app entirely - allow user to retry or proceed
        setTimeout(() => {
          setIsInitializing(false);
          setInitError(null);
        }, 5000);
      }
    }

    initialize();
  }, [mode]);

  // Show initialization screen during Tesseract preload (WASM mode only)
  if (isInitializing) {
    return <InitializationScreen progress={initProgress} error={initError} />;
  }

  // Get base path from runtime config (injected by docker-entrypoint.sh)
  const basePath = config.basePath;

  return (
    <BrowserRouter basename={basePath}>
      <OfflineBanner />

      {/* Only show onboarding in WASM mode */}
      {mode === "wasm" && <Onboarding />}

      {/* Only enable WebSocket in server mode */}
      {mode === "server" && <WebSocketIntegration />}

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: "#363636",
            color: "#fff",
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: "#10B981",
              secondary: "#fff",
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: "#EF4444",
              secondary: "#fff",
            },
          },
        }}
      />

      <AppRouter />
    </BrowserRouter>
  );
}

export default App;
