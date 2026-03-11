import { useEffect, useState } from "react";
import { config } from "../../config";
import type { UpdateInfo } from "../../lib/updater";

type BannerState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; info: UpdateInfo }
  | { status: "downloading"; percent: number | null }
  | { status: "ready" }
  | { status: "error"; message: string }
  | { status: "dismissed" };

export const UpdateBanner = () => {
  const [state, setState] = useState<BannerState>({ status: "idle" });

  useEffect(() => {
    if (!config.isTauri) return;

    const timer = setTimeout(async () => {
      console.log("[UpdateBanner] Checking for updates...");
      setState({ status: "checking" });
      try {
        const { checkForUpdate } = await import("../../lib/updater");
        const info = await checkForUpdate();
        console.log("[UpdateBanner] Check result:", info);
        if (info) {
          setState({ status: "available", info });
        } else {
          setState({ status: "idle" });
        }
      } catch (err) {
        console.error("[UpdateBanner] Update check failed:", err);
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Update check failed",
        });
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = async () => {
    setState({ status: "downloading", percent: null });

    let downloadedSoFar = 0;

    try {
      const { downloadAndInstall } = await import("../../lib/updater");
      await downloadAndInstall((progress) => {
        downloadedSoFar += progress.downloaded;
        if (progress.total > 0) {
          const percent = Math.min(
            100,
            Math.round((downloadedSoFar / progress.total) * 100),
          );
          setState({ status: "downloading", percent });
        } else {
          setState({ status: "downloading", percent: null });
        }
      });
      setState({ status: "ready" });
    } catch (err) {
      console.error("[UpdateBanner] Download/install failed:", err);
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  };

  const handleRestart = async () => {
    try {
      const { relaunchApp } = await import("../../lib/updater");
      await relaunchApp();
    } catch (err) {
      console.error("[UpdateBanner] Relaunch failed:", err);
      setState({
        status: "error",
        message: "Could not restart automatically. Please close and reopen the app.",
      });
    }
  };

  const dismiss = () => setState({ status: "dismissed" });

  // Show nothing for idle, checking, dismissed, or non-Tauri
  if (
    state.status === "idle" ||
    state.status === "checking" ||
    state.status === "dismissed" ||
    !config.isTauri
  ) {
    return null;
  }

  if (state.status === "available") {
    return (
      <div className="flex items-center justify-between gap-3 bg-indigo-600 px-4 py-2 text-sm text-white">
        <span>
          Version <strong>{state.info.version}</strong> available
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUpdate}
            className="rounded bg-white px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
          >
            Update now
          </button>
          <button
            onClick={dismiss}
            className="text-indigo-200 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "downloading") {
    const isIndeterminate = state.percent === null;
    return (
      <div className="bg-indigo-600 px-4 py-2 text-sm text-white">
        <div className="flex items-center justify-between mb-1">
          <span>Downloading update...{isIndeterminate ? "" : ` ${state.percent}%`}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-indigo-400/40 overflow-hidden">
          <div
            className={`h-full rounded-full bg-white ${isIndeterminate ? "animate-pulse w-full opacity-60" : "transition-all duration-300"}`}
            style={isIndeterminate ? undefined : { width: `${state.percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      <div className="flex items-center justify-between gap-3 bg-emerald-600 px-4 py-2 text-sm text-white">
        <span>Update installed — Restart to apply</span>
        <button
          onClick={handleRestart}
          className="rounded bg-white px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
        >
          Restart
        </button>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex items-center justify-between gap-3 bg-red-600 px-4 py-2 text-sm text-white">
        <span>Update failed: {state.message}</span>
        <button
          onClick={dismiss}
          className="text-red-200 hover:text-white transition-colors"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    );
  }

  return null;
};
