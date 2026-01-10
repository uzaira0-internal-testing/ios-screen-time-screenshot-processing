/**
 * Settings Page
 *
 * Application settings including mode switching, preferences, and data management.
 */

import React from "react";
import { Layout } from "@/components/layout/Layout";
import { ModeSwitch } from "@/components/pwa/ModeSwitch";
import { useMode } from "@/hooks/useMode";
import { Link } from "react-router-dom";

export const SettingsPage: React.FC = () => {
  const { mode, config } = useMode();

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-1">
            Configure your screenshot processing preferences
          </p>
        </div>

        {/* Current Mode Info */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-3xl">{mode === "wasm" ? "💻" : "🖥️"}</div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Current Mode: {mode === "wasm" ? "Local (WASM)" : "Server"}
              </h2>
              <p className="text-sm text-gray-600">
                {mode === "wasm"
                  ? "Processing happens entirely in your browser"
                  : "Using backend server for processing"}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 p-3 rounded">
              <div className="font-medium text-gray-700">Data Storage</div>
              <div className="text-gray-600 mt-1">
                {mode === "wasm" ? "IndexedDB (Local)" : "Server Database"}
              </div>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <div className="font-medium text-gray-700">Processing</div>
              <div className="text-gray-600 mt-1">
                {mode === "wasm"
                  ? "Browser (WASM + Tesseract.js)"
                  : "Backend (Python + Tesseract)"}
              </div>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <div className="font-medium text-gray-700">Network Required</div>
              <div className="text-gray-600 mt-1">
                {mode === "wasm"
                  ? "No (Works Offline)"
                  : "Yes (Server Connection)"}
              </div>
            </div>
          </div>
        </div>

        {/* Mode Switching */}
        {config.canSwitchMode && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Switch Processing Mode
            </h2>
            <p className="text-gray-600 mb-6">
              You can switch between local (WASM) and server modes based on your
              needs. Your data will remain accessible in both modes.
            </p>
            <ModeSwitch />
          </div>
        )}

        {/* Mode-specific settings */}
        {mode === "wasm" && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Local Mode Settings
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-gray-200">
                <div>
                  <div className="font-medium text-gray-900">
                    Auto-process uploads
                  </div>
                  <div className="text-sm text-gray-600">
                    Automatically process screenshots after upload
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    defaultChecked
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-gray-200">
                <div>
                  <div className="font-medium text-gray-900">
                    Save debug images
                  </div>
                  <div className="text-sm text-gray-600">
                    Save intermediate processing steps for debugging
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900">
                    Enable PWA features
                  </div>
                  <div className="text-sm text-gray-600">
                    Install as app, offline support, background sync
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    defaultChecked
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {mode === "server" && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Server Mode Settings
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-gray-200">
                <div>
                  <div className="font-medium text-gray-900">
                    Real-time notifications
                  </div>
                  <div className="text-sm text-gray-600">
                    Show WebSocket notifications for team activity
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    defaultChecked
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-gray-900">
                    Auto-refresh on updates
                  </div>
                  <div className="text-sm text-gray-600">
                    Automatically refresh when other users make changes
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    defaultChecked
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* About Section */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">About</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <p>
              <strong>Version:</strong> 1.0.0
            </p>
            <p>
              <strong>Build:</strong>{" "}
              {mode === "wasm" ? "WASM (Standalone)" : "Server (Collaborative)"}
            </p>
            <p>
              <strong>Browser:</strong> {navigator.userAgent.split(" ").pop()}
            </p>
            {mode === "wasm" && (
              <p>
                <strong>Storage:</strong> IndexedDB (
                {typeof navigator.storage !== "undefined" &&
                typeof navigator.storage.estimate === "function"
                  ? "Quota available"
                  : "Limited"}
                )
              </p>
            )}
            {mode === "server" && config.apiBaseUrl && (
              <p>
                <strong>API Endpoint:</strong> {config.apiBaseUrl}
              </p>
            )}
          </div>
        </div>

        {/* Navigation back */}
        <div className="flex justify-center">
          <Link
            to="/"
            className="px-6 py-3 text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors font-medium"
          >
            ← Back to {mode === "wasm" ? "Screenshots" : "Home"}
          </Link>
        </div>
      </div>
    </Layout>
  );
};
