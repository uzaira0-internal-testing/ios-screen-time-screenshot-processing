import { useEffect } from "react";
import { BrowserRouter } from "react-router";
import { Toaster } from "react-hot-toast";
import toast from "react-hot-toast";
import { AppRouter } from "./components/routing/AppRouter";
import { useWebSocket } from "./hooks/useWebSocket";
import { useAuthStore } from "./store/authStore";
import { config } from "./config";
import type {
  AnnotationSubmittedEvent,
  ScreenshotCompletedEvent,
  UserJoinedEvent,
  UserLeftEvent,
} from "./types/websocket";

/**
 * WebSocket integration component for real-time updates
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
      unsubscribeScreenshotCompleted();
      unsubscribeUserJoined();
      unsubscribeUserLeft();
    };
  }, [subscribe, isAuthenticated]);

  return null;
}

/**
 * Main App Component
 */
function App() {
  const basePath = config.basePath;

  return (
    <BrowserRouter basename={basePath}>
      <WebSocketIntegration />

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
