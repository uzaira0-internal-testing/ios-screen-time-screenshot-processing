import { useMemo } from "react";
import { usePreprocessingStore } from "@/store/preprocessingStore";
import type { FilterMode } from "@/store/preprocessingStore";
import type { Screenshot } from "@/types";

const FILTER_DEFS: { id: FilterMode; label: string; color: string }[] = [
  { id: "all", label: "All", color: "text-gray-700 bg-gray-100" },
  { id: "needs_review", label: "Needs Review", color: "text-yellow-700 bg-yellow-50" },
  { id: "invalidated", label: "Invalidated", color: "text-orange-700 bg-orange-50" },
  { id: "completed", label: "Completed", color: "text-green-700 bg-green-50" },
  { id: "pending", label: "Pending", color: "text-gray-500 bg-gray-50" },
];

export const StageSummaryBar = () => {
  const filter = usePreprocessingStore((s) => s.filter);
  const setFilter = usePreprocessingStore((s) => s.setFilter);
  const activeStage = usePreprocessingStore((s) => s.activeStage);
  const screenshots = usePreprocessingStore((s) => s.screenshots);
  const getStageStatus = usePreprocessingStore((s) => s.getStageStatus);
  const getEligibleCount = usePreprocessingStore((s) => s.getEligibleCount);
  const summary = usePreprocessingStore((s) => s.summary);
  const isRunningStage = usePreprocessingStore((s) => s.isRunningStage);
  const stageProgress = usePreprocessingStore((s) => s.stageProgress);
  const runStage = usePreprocessingStore((s) => s.runStage);
  const resetStage = usePreprocessingStore((s) => s.resetStage);

  const enterQueue = usePreprocessingStore((s) => s.enterQueue);
  const getScreenshotsForStage = usePreprocessingStore((s) => s.getScreenshotsForStage);

  const counts = summary ? summary[activeStage] : getStageStatus(activeStage);
  const total = summary?.total ?? screenshots.length;

  // Count for each filter
  const filterCounts: Record<FilterMode, number> = {
    all: total,
    needs_review: counts.exceptions,
    invalidated: counts.invalidated,
    completed: counts.completed,
    pending: counts.pending,
  };

  // Eligible = pending/invalidated AND prerequisites completed
  const { eligible, blockedByPrereq } = useMemo(
    () => getEligibleCount(activeStage),
    [getEligibleCount, activeStage, screenshots],
  );

  // Stage label for the run button
  const stageLabel = activeStage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Previous stage label for the "blocked" message
  const STAGE_LABELS: Record<string, string> = {
    device_detection: "Device Detection",
    cropping: "Cropping",
    phi_detection: "PHI Detection",
    phi_redaction: "PHI Redaction",
  };
  const STAGE_ORDER = ["device_detection", "cropping", "phi_detection", "phi_redaction"];
  const stageIdx = STAGE_ORDER.indexOf(activeStage);
  const prevStageLabel = stageIdx > 0 ? STAGE_LABELS[STAGE_ORDER[stageIdx - 1]!] : null;

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-lg" role="toolbar" aria-label="Preprocessing stage controls">
      {/* Filter toggles */}
      <div className="flex items-center gap-1">
        {FILTER_DEFS.map((f) => {
          const count = filterCounts[f.id];
          if (f.id !== "all" && count === 0) return null;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filter === f.id
                  ? `${f.color} ring-1 ring-current`
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Progress bar when running */}
      {isRunningStage && stageProgress && (
        <div className="flex items-center gap-2 ml-2">
          <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-600 rounded-full transition-all"
              style={{ width: `${(stageProgress.completed / stageProgress.total) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">
            {stageProgress.completed}/{stageProgress.total}
          </span>
          <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Blocked-by-prerequisite hint */}
      {!isRunningStage && blockedByPrereq > 0 && (
        <span className="text-xs text-amber-600 ml-2">
          {blockedByPrereq} blocked — complete {prevStageLabel} first
        </span>
      )}

      {/* Review queue button */}
      {total > 0 && (
        <button
          onClick={() => {
            const filtered = getScreenshotsForStage(activeStage);
            if (filtered.length > 0) {
              enterQueue(filtered.map((s: Screenshot) => s.id));
            }
          }}
          className="ml-2 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-md hover:bg-primary-100 transition-colors"
        >
          Review ({filterCounts[filter]})
        </button>
      )}

      {/* Re-run button — shows when all are completed and nothing is eligible */}
      {!isRunningStage && eligible === 0 && counts.completed > 0 && (
        <button
          onClick={() => resetStage(activeStage)}
          className="ml-auto px-4 py-1.5 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 transition-colors"
        >
          Reset & Re-run {stageLabel} ({counts.completed})
        </button>
      )}

      {/* Run button */}
      <button
        onClick={() => runStage(activeStage)}
        disabled={isRunningStage || eligible === 0}
        className={`${eligible === 0 && counts.completed > 0 ? "" : "ml-auto "}px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:bg-gray-400 disabled:text-gray-200 disabled:cursor-not-allowed transition-colors`}
      >
        {isRunningStage
          ? "Running..."
          : `Run ${stageLabel} on ${eligible} screenshot${eligible !== 1 ? "s" : ""}`}
      </button>
    </div>
  );
};
