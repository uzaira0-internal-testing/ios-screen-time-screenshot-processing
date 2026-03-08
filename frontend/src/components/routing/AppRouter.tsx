/**
 * Application Router (Server Mode Only)
 *
 * Multi-user collaborative routes with authentication.
 */

import React from "react";
import { Routes, Route, Navigate } from "react-router";

// Pages
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { AnnotationPage } from "@/pages/AnnotationPage";
import { AdminPage } from "@/pages/AdminPage";
import { ConsensusPage } from "@/pages/ConsensusPage";
import { ConsensusComparisonPage } from "@/pages/ConsensusComparisonPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { PreprocessingPage } from "@/pages/PreprocessingPage";
import { UploadPage } from "@/pages/UploadPage";

// Auth guard
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

// Redirect authenticated users away from login page
const LoginRoute: React.FC = () => {
  const { isAuthenticated } = useAuthStore();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
};

export const AppRouter: React.FC = () => {
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
      {/* Upload */}
      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            <UploadPage />
          </ProtectedRoute>
        }
      />
      {/* Preprocessing Pipeline */}
      <Route
        path="/preprocessing"
        element={
          <ProtectedRoute>
            <PreprocessingPage />
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
