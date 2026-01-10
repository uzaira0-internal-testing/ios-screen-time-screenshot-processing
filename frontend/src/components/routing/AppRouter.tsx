/**
 * Mode-aware Application Router
 *
 * Conditionally renders routes based on the current application mode.
 * - WASM mode: Single-user offline routes
 * - Server mode: Multi-user collaborative routes with authentication
 */

import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMode } from "@/hooks/useMode";

// WASM mode pages
import { WasmHomePage } from "@/pages/WasmHomePage";
import { SettingsPage } from "@/pages/SettingsPage";

// Server mode pages
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { AnnotationPage } from "@/pages/AnnotationPage";
import { AdminPage } from "@/pages/AdminPage";
import { ConsensusPage } from "@/pages/ConsensusPage";
import { ConsensusComparisonPage } from "@/pages/ConsensusComparisonPage";

// Auth guard for server mode
import { useAuthStore } from "@/store/authStore";

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

export const AppRouter: React.FC = () => {
  const { mode } = useMode();

  if (mode === "wasm") {
    // WASM mode routes - no authentication required
    return (
      <Routes>
        <Route path="/" element={<WasmHomePage />} />
        <Route path="/annotate" element={<AnnotationPage />} />
        <Route path="/annotate/:id" element={<AnnotationPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Server mode routes - authentication required for most pages
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
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
      {/* Consensus / Cross-Rater Comparison */}
      <Route
        path="/consensus"
        element={
          <ProtectedRoute>
            <ConsensusPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/consensus/compare/:screenshotId"
        element={
          <ProtectedRoute>
            <ConsensusComparisonPage />
          </ProtectedRoute>
        }
      />
      {/* Legacy routes - redirect to home */}
      <Route path="/history" element={<Navigate to="/" replace />} />
      <Route path="/disputed" element={<Navigate to="/consensus" replace />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
