import React from "react";
import { Layout } from "@/components/layout/Layout";
import { Link } from "react-router";
import { config } from "@/config";
import { environment } from "@/config/environment";
import {
  Monitor,
  Wifi,
  WifiOff,
  RefreshCw,
  Server,
  AlertTriangle,
  ArrowLeft,
  HardDrive,
  Globe,
  Loader2,
  X,
  Sun,
  Moon,
} from "lucide-react";
import { useSyncStore } from "@/core/implementations/wasm/sync";
import { useThemeStore } from "@/store/themeStore";

function SyncSection() {
  const {
    isOnline,
    isSyncing,
    lastSyncAt,
    pendingUploads,
    serverUrl,
    username,
    errors,
    setServerUrl,
    setUsername,
    syncNow,
    clearErrors,
    refreshPendingCounts,
  } = useSyncStore();

  React.useEffect(() => {
    refreshPendingCounts();
  }, [refreshPendingCounts]);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-4">
        <Server className="w-6 h-6 text-primary-700" />
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Sync to Server
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Push local data to a server for multi-user consensus
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isOnline ? (
            <span className="flex items-center gap-1 text-sm text-green-700">
              <Wifi className="w-4 h-4" /> Online
            </span>
          ) : (
            <span className="flex items-center gap-1 text-sm text-slate-500">
              <WifiOff className="w-4 h-4" /> Offline
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="sync-server-url"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Server API URL
          </label>
          <input
            id="sync-server-url"
            type="url"
            placeholder="http://localhost:8002/api/v1"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label
            htmlFor="sync-username"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Username
          </label>
          <input
            id="sync-username"
            type="text"
            placeholder="your-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={syncNow}
            disabled={isSyncing || !serverUrl || !username}
            className="flex items-center gap-2 px-4 py-2 bg-primary-700 text-white rounded-md text-sm font-medium hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-ring"
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>

          <div className="text-sm text-slate-600 dark:text-slate-400 space-x-4">
            {pendingUploads > 0 && (
              <span>{pendingUploads} pending upload{pendingUploads !== 1 ? "s" : ""}</span>
            )}
            {lastSyncAt && (
              <span>
                Last sync: {new Date(lastSyncAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1 text-sm font-medium text-red-800">
                <AlertTriangle className="w-4 h-4" /> Sync Errors
              </span>
              <button
                onClick={clearErrors}
                className="text-red-600 hover:text-red-800 focus-ring"
                aria-label="Clear errors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ul className="text-sm text-red-700 space-y-1">
              {errors.map((err, i) => (
                <li key={i}>{err.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export const SettingsPage: React.FC = () => {
  const isWasmMode = environment.mode === "wasm";
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();

  const themeOptions = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "System", icon: Monitor },
  ];

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Settings</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Configure your screenshot processing preferences
          </p>
        </div>

        {/* Theme */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Theme
          </h2>
          <div className="flex gap-3">
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setThemeMode(value)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  themeMode === value
                    ? "bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-400"
                    : "bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Current Mode Info */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            {isWasmMode ? (
              <HardDrive className="w-8 h-8 text-primary-700" />
            ) : (
              <Monitor className="w-8 h-8 text-primary-700" />
            )}
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {isWasmMode ? "Local (WASM) Mode" : "Server Mode"}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {isWasmMode
                  ? "Processing locally in the browser"
                  : "Using backend server for processing"}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded">
              <div className="font-medium text-slate-700 dark:text-slate-300">Data Storage</div>
              <div className="text-slate-600 dark:text-slate-400 mt-1">
                {isWasmMode ? "IndexedDB + OPFS" : "Server Database"}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded">
              <div className="font-medium text-slate-700 dark:text-slate-300">Processing</div>
              <div className="text-slate-600 dark:text-slate-400 mt-1">
                {isWasmMode
                  ? "Tesseract.js (Web Worker)"
                  : "Backend (Python + Tesseract)"}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 p-3 rounded">
              <div className="font-medium text-slate-700 dark:text-slate-300">Network Required</div>
              <div className="text-slate-600 dark:text-slate-400 mt-1">
                {isWasmMode ? (
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> No (Offline Capable)
                  </span>
                ) : (
                  "Yes (Server Connection)"
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sync section (WASM mode only) */}
        {isWasmMode && <SyncSection />}

        {/* Server Mode Settings */}
        {!isWasmMode && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
              Server Mode Settings
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-slate-200 dark:border-slate-700">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    Real-time notifications
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Show WebSocket notifications for team activity
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    defaultChecked
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    Auto-refresh on updates
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    Automatically refresh when other users make changes
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    defaultChecked
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* About Section */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">About</h2>
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <p>
              <strong>Version:</strong> 1.0.0
            </p>
            <p>
              <strong>Build:</strong>{" "}
              {isWasmMode ? "WASM (Local-First)" : "Server (Collaborative)"}
            </p>
            <p>
              <strong>Browser:</strong> {navigator.userAgent.split(" ").pop()}
            </p>
            {config.apiBaseUrl && (
              <p>
                <strong>API Endpoint:</strong> {config.apiBaseUrl}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-center">
          <Link
            to="/"
            className="flex items-center gap-2 px-6 py-3 text-primary-700 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors font-medium focus-ring"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </div>
    </Layout>
  );
};
