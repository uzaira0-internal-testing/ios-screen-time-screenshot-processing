import { useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { usePreprocessingStore } from "@/store/preprocessingStore";
import type { Stage } from "@/store/preprocessingStore";
import { PreprocessingWizard } from "@/components/preprocessing/PreprocessingWizard";
import { StageSummaryBar } from "@/components/preprocessing/StageSummaryBar";
import { DeviceDetectionTab } from "@/components/preprocessing/DeviceDetectionTab";
import { CroppingTab } from "@/components/preprocessing/CroppingTab";
import { PHIDetectionTab } from "@/components/preprocessing/PHIDetectionTab";
import { PHIRedactionTab } from "@/components/preprocessing/PHIRedactionTab";
import { EventLogPanel } from "@/components/preprocessing/EventLogPanel";
import { PreprocessingQueueView } from "@/components/preprocessing/PreprocessingQueueView";
import { api } from "@/services/apiClient";

export const PreprocessingPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const groups = usePreprocessingStore((s) => s.groups);
  const selectedGroupId = usePreprocessingStore((s) => s.selectedGroupId);
  const setSelectedGroupId = usePreprocessingStore((s) => s.setSelectedGroupId);
  const loadGroups = usePreprocessingStore((s) => s.loadGroups);
  const screenshots = usePreprocessingStore((s) => s.screenshots);
  const isLoading = usePreprocessingStore((s) => s.isLoading);
  const activeStage = usePreprocessingStore((s) => s.activeStage);
  const setActiveStage = usePreprocessingStore((s) => s.setActiveStage);
  const eventLog = usePreprocessingStore((s) => s.eventLog);
  const phiPreset = usePreprocessingStore((s) => s.phiPreset);
  const setPhiPreset = usePreprocessingStore((s) => s.setPhiPreset);
  const redactionMethod = usePreprocessingStore((s) => s.redactionMethod);
  const setRedactionMethod = usePreprocessingStore((s) => s.setRedactionMethod);
  const llmEnabled = usePreprocessingStore((s) => s.llmEnabled);
  const setLlmEnabled = usePreprocessingStore((s) => s.setLlmEnabled);
  const llmEndpoint = usePreprocessingStore((s) => s.llmEndpoint);
  const setLlmEndpoint = usePreprocessingStore((s) => s.setLlmEndpoint);
  const llmModel = usePreprocessingStore((s) => s.llmModel);
  const setLlmModel = usePreprocessingStore((s) => s.setLlmModel);
  const stopPolling = usePreprocessingStore((s) => s.stopPolling);
  const setHighlightedScreenshotId = usePreprocessingStore((s) => s.setHighlightedScreenshotId);
  const setReturnUrl = usePreprocessingStore((s) => s.setReturnUrl);
  const returnUrl = usePreprocessingStore((s) => s.returnUrl);
  const queueMode = usePreprocessingStore((s) => s.queueMode);

  // Load groups on mount, cleanup polling on unmount
  useEffect(() => {
    loadGroups();
    return () => stopPolling();
  }, [loadGroups, stopPolling]);

  const VALID_STAGES = ["device_detection", "cropping", "phi_detection", "phi_redaction"];

  // Restore state from URL params on mount
  useEffect(() => {
    const stageParam = searchParams.get("stage");
    const groupParam = searchParams.get("group");
    const screenshotId = searchParams.get("screenshot_id");
    const returnUrlParam = searchParams.get("returnUrl");

    if (returnUrlParam) {
      setReturnUrl(returnUrlParam);
    }
    if (stageParam && VALID_STAGES.includes(stageParam)) {
      setActiveStage(stageParam as Stage);
    }
    if (groupParam) {
      setSelectedGroupId(groupParam);
    }

    if (screenshotId) {
      const id = parseInt(screenshotId, 10);
      if (!isNaN(id)) {
        api.screenshots.getById(id).then((screenshot) => {
          if (screenshot?.group_id) {
            setSelectedGroupId(screenshot.group_id);
          }
          setHighlightedScreenshotId(id);

          if (stageParam && VALID_STAGES.includes(stageParam)) {
            setActiveStage(stageParam as Stage);
          } else {
            const pp = (screenshot?.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
            const stageStatus = pp?.stage_status as Record<string, string> | undefined;
            if (stageStatus) {
              const stageOrder = ["device_detection", "cropping", "phi_detection", "phi_redaction"] as const;
              for (const s of stageOrder) {
                if (stageStatus[s] === "invalidated" || stageStatus[s] === "pending" || stageStatus[s] === "failed") {
                  setActiveStage(s);
                  break;
                }
              }
            }
          }
        }).catch(() => {
          // Screenshot not found - ignore
        });
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync active stage and group to URL
  const syncToUrl = useCallback(() => {
    setSearchParams((prev: URLSearchParams) => {
      const next = new URLSearchParams(prev);
      next.set("stage", activeStage);
      if (selectedGroupId) {
        next.set("group", selectedGroupId);
      }
      return next;
    }, { replace: true });
  }, [activeStage, selectedGroupId, setSearchParams]);

  useEffect(() => {
    syncToUrl();
  }, [syncToUrl]);

  return (
    <Layout>
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {returnUrl && (
            <Link
              to={returnUrl}
              className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              &larr; Back to Annotation
            </Link>
          )}
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Preprocessing Pipeline
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Group:</label>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="text-sm border border-slate-300 dark:border-slate-600 rounded-md px-3 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-100"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.screenshot_count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {queueMode ? (
        <PreprocessingQueueView />
      ) : (
        <>
          {/* Pipeline wizard steps */}
          <PreprocessingWizard />

          {/* Options - show preset/method controls for PHI stages */}
          {(activeStage === "phi_detection" || activeStage === "phi_redaction") && (
            <div className="mt-3 flex flex-wrap items-center gap-4 p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              {activeStage === "phi_detection" && (
                <>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Preset:
                    </label>
                    <select
                      value={phiPreset}
                      onChange={(e) => setPhiPreset(e.target.value)}
                      className="text-sm border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 dark:bg-slate-700 dark:text-slate-100"
                    >
                      <option value="screen_time">Screen Time</option>
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="hipaa_compliant">HIPAA Compliant</option>
                      <option value="thorough">Thorough</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 border-l border-slate-300 dark:border-slate-600 pl-4">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={llmEnabled}
                        onChange={(e) => setLlmEnabled(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                      LLM-Assisted
                    </label>
                  </div>
                  {llmEnabled && (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">Endpoint:</label>
                        <input
                          type="text"
                          value={llmEndpoint}
                          onChange={(e) => setLlmEndpoint(e.target.value)}
                          className="text-sm border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 w-56 dark:bg-slate-700 dark:text-slate-100"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-slate-600 dark:text-slate-300">Model:</label>
                        <input
                          type="text"
                          value={llmModel}
                          onChange={(e) => setLlmModel(e.target.value)}
                          className="text-sm border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 w-36 dark:bg-slate-700 dark:text-slate-100"
                        />
                      </div>
                      <span className="text-xs text-slate-400">Runs LLM alongside Presidio for higher accuracy</span>
                    </>
                  )}
                </>
              )}
              {activeStage === "phi_redaction" && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Method:
                  </label>
                  <select
                    value={redactionMethod}
                    onChange={(e) => setRedactionMethod(e.target.value)}
                    className="text-sm border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1 dark:bg-slate-700 dark:text-slate-100"
                  >
                    <option value="redbox">Red Box</option>
                    <option value="blackbox">Black Box</option>
                    <option value="pixelate">Pixelate</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Filter bar and run button */}
          <div className="mt-3">
            <StageSummaryBar />
          </div>

          {/* Stage content */}
          <div className="mt-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <span className="inline-block w-6 h-6 border-2 border-slate-300 border-t-primary-600 rounded-full animate-spin" />
                <span className="ml-2 text-slate-500">Loading screenshots...</span>
              </div>
            ) : (
              <>
                {/* Keep tabs mounted but hidden to preserve scroll/sort state and avoid remount cost */}
                <div className={activeStage === "device_detection" ? "" : "hidden"}><DeviceDetectionTab /></div>
                <div className={activeStage === "cropping" ? "" : "hidden"}><CroppingTab /></div>
                <div className={activeStage === "phi_detection" ? "" : "hidden"}><PHIDetectionTab /></div>
                <div className={activeStage === "phi_redaction" ? "" : "hidden"}><PHIRedactionTab /></div>
              </>
            )}
          </div>

          {/* Footer info */}
          <div className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""} in
            group
            {selectedGroupId && ` "${selectedGroupId}"`}
          </div>

          {/* Event log side panel */}
          {eventLog && <EventLogPanel />}
        </>
      )}
    </div>
    </Layout>
  );
};
