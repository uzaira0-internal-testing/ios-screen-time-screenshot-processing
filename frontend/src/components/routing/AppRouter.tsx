/**
 * Application Router
 *
 * Multi-user collaborative routes with authentication.
 * Feature availability is determined by the DI container's AppFeatures,
 * not by direct mode checks.
 */

import React from "react";
import { Routes, Route, Navigate } from "react-router";

// Pages
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { AnnotationPage } from "@/pages/AnnotationPage";
import { ConsensusPage } from "@/pages/ConsensusPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { UploadPage } from "@/pages/UploadPage";

// Lazy-load server-only pages
const AdminPage = React.lazy(() =>
  import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const ConsensusComparisonPage = React.lazy(() =>
  import("@/pages/ConsensusComparisonPage").then((m) => ({
    default: m.ConsensusComparisonPage,
  })),
);
const PreprocessingPage = React.lazy(() =>
  import("@/pages/PreprocessingPage").then((m) => ({
    default: m.PreprocessingPage,
  })),
);

// Auth guard
import { useAuthStore } from "@/store/authStore";
import { useFeatures } from "@/core/hooks/useServices";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Redirect authenticated users away from login page
const LoginRoute: React.FC = () => {
  const { isAuthenticated } = useAuthStore();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
};

const ServerOnlyFallback = (
  <div className="flex items-center justify-center h-96">
    <span className="inline-block w-6 h-6 border-2 border-slate-300 border-t-primary-600 rounded-full animate-spin" />
  </div>
);

export const AppRouter: React.FC = () => {
  const features = useFeatures();

  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/annotate"
        element={
          <ProtectedRoute>
            <AnnotationPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/annotate/:id"
        element={
          <ProtectedRoute>
            <AnnotationPage />
          </ProtectedRoute>
        }
      />
      {/* Consensus — basic tier view works in all modes */}
      <Route
        path="/consensus"
        element={
          <ProtectedRoute>
            <ConsensusPage />
          </ProtectedRoute>
        }
      />
      {/* Cross-rater comparison — server only (requires multiple real users) */}
      <Route
        path="/consensus/compare/:screenshotId"
        element={
          <ProtectedRoute>
            {features.consensusComparison ? (
              <React.Suspense fallback={ServerOnlyFallback}>
                <ConsensusComparisonPage />
              </React.Suspense>
            ) : (
              <Navigate to="/consensus" replace />
            )}
          </ProtectedRoute>
        }
      />
      {/* Upload (server only — WASM mode uploads via HomePage drag-and-drop) */}
      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            {features.preprocessing ? (
              <UploadPage />
            ) : (
              <Navigate to="/" replace />
            )}
          </ProtectedRoute>
        }
      />
      {/* Preprocessing Pipeline (server only) */}
      <Route
        path="/preprocessing"
        element={
          <ProtectedRoute>
            {features.preprocessing ? (
              <React.Suspense fallback={ServerOnlyFallback}>
                <PreprocessingPage />
              </React.Suspense>
            ) : (
              <Navigate to="/" replace />
            )}
          </ProtectedRoute>
        }
      />
      {/* Legacy routes */}
      <Route path="/history" element={<Navigate to="/" replace />} />
      <Route path="/disputed" element={<Navigate to="/consensus" replace />} />
      {/* Admin (server only) */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            {features.admin ? (
              <React.Suspense fallback={ServerOnlyFallback}>
                <AdminPage />
              </React.Suspense>
            ) : (
              <Navigate to="/" replace />
            )}
          </ProtectedRoute>
        }
      />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
