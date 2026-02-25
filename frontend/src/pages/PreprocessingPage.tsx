import { useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { usePreprocessingStore } from "@/store/preprocessingStore";
import { PreprocessingWizard } from "@/components/preprocessing/PreprocessingWizard";
import { StageSummaryBar } from "@/components/preprocessing/StageSummaryBar";
import { DeviceDetectionTab } from "@/components/preprocessing/DeviceDetectionTab";
import { CroppingTab } from "@/components/preprocessing/CroppingTab";
import { PHIDetectionTab } from "@/components/preprocessing/PHIDetectionTab";
import { PHIRedactionTab } from "@/components/preprocessing/PHIRedactionTab";
import { EventLogPanel } from "@/components/preprocessing/EventLogPanel";
import { BrowserUpload } from "@/components/preprocessing/BrowserUpload";
import { api } from "@/services/apiClient";

export const PreprocessingPage = () => {
  const [searchParams] = useSearchParams();
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
  const stopPolling = usePreprocessingStore((s) => s.stopPolling);
  const pageMode = usePreprocessingStore((s) => s.pageMode);
  const setPageMode = usePreprocessingStore((s) => s.setPageMode);
  const setHighlightedScreenshotId = usePreprocessingStore((s) => s.setHighlightedScreenshotId);
  const setReturnUrl = usePreprocessingStore((s) => s.setReturnUrl);
  const returnUrl = usePreprocessingStore((s) => s.returnUrl);

  // Load groups on mount, cleanup polling on unmount
  useEffect(() => {
    loadGroups();
    return () => stopPolling();
  }, [loadGroups, stopPolling]);

  // Handle deep-link query params
  useEffect(() => {
    const screenshotId = searchParams.get("screenshot_id");
    const stage = searchParams.get("stage");
    const returnUrlParam = searchParams.get("returnUrl");

    if (returnUrlParam) {
      setReturnUrl(returnUrlParam);
    }

    if (screenshotId) {
      const id = parseInt(screenshotId, 10);
      if (!isNaN(id)) {
        // Fetch the screenshot to get its group_id, then navigate to it
        api.screenshots.getById(id).then((screenshot) => {
          if (screenshot?.group_id) {
            setSelectedGroupId(screenshot.group_id);
          }
          setHighlightedScreenshotId(id);

          // Navigate to specified stage or first incomplete/invalidated stage
          if (stage && ["device_detection", "cropping", "phi_detection", "phi_redaction"].includes(stage)) {
            setActiveStage(stage as typeof activeStage);
          } else {
            // Find first problematic stage from preprocessing metadata
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
  }, [searchParams, setSelectedGroupId, setHighlightedScreenshotId, setActiveStage, setReturnUrl]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {returnUrl && (
            <Link
              to={returnUrl}
              className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              &larr; Back to Annotation
            </Link>
          )}
          <h1 className="text-2xl font-bold text-gray-900">
            Preprocessing Pipeline
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Upload/Pipeline toggle */}
          <div className="flex items-center bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setPageMode("pipeline")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                pageMode === "pipeline" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
              }`}
            >
              Pipeline
            </button>
            <button
              onClick={() => setPageMode("upload")}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                pageMode === "upload" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
              }`}
            >
              Upload
            </button>
          </div>

          {pageMode === "pipeline" && (
            <>
              <label className="text-sm font-medium text-gray-700">Group:</label>
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.screenshot_count})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Upload mode */}
      {pageMode === "upload" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <BrowserUpload />
        </div>
      )}

      {/* Pipeline mode */}
      {pageMode === "pipeline" && (
        <>
          {/* Pipeline wizard steps */}
          <PreprocessingWizard />

          {/* Options - show preset/method controls for PHI stages */}
          {(activeStage === "phi_detection" || activeStage === "phi_redaction") && (
            <div className="mt-3 flex flex-wrap items-center gap-4 p-3 bg-white rounded-lg border border-gray-200">
              {activeStage === "phi_detection" && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">
                    Preset:
                  </label>
                  <select
                    value={phiPreset}
                    onChange={(e) => setPhiPreset(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1"
                  >
                    <option value="fast">Fast</option>
                    <option value="balanced">Balanced</option>
                    <option value="hipaa_compliant">HIPAA Compliant</option>
                    <option value="thorough">Thorough</option>
                  </select>
                </div>
              )}
              {activeStage === "phi_redaction" && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-700">
                    Method:
                  </label>
                  <select
                    value={redactionMethod}
                    onChange={(e) => setRedactionMethod(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1"
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
          <div className="mt-4 bg-white rounded-lg border border-gray-200">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <span className="inline-block w-6 h-6 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
                <span className="ml-2 text-gray-500">Loading screenshots...</span>
              </div>
            ) : (
              <>
                {activeStage === "device_detection" && <DeviceDetectionTab />}
                {activeStage === "cropping" && <CroppingTab />}
                {activeStage === "phi_detection" && <PHIDetectionTab />}
                {activeStage === "phi_redaction" && <PHIRedactionTab />}
              </>
            )}
          </div>

          {/* Footer info */}
          <div className="mt-4 text-xs text-gray-400">
            {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""} in
            group
            {selectedGroupId && ` "${selectedGroupId}"`}
          </div>

          {/* Event log side panel */}
          {eventLog && <EventLogPanel />}
        </>
      )}
    </div>
  );
};
