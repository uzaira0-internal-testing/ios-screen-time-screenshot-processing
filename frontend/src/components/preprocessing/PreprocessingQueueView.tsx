import { useEffect, useMemo, useState } from "react";
import { usePreprocessingStore } from "@/store/preprocessingStore";
import { QueueNavigationBar } from "./QueueNavigationBar";
import { PHIRegionEditor } from "./PHIRegionEditor";
import { CropAdjustModal } from "./CropAdjustModal";
import { getCurrentEvent } from "./StageReviewTable";
import { getCropRectFromEvent } from "./CroppingTab";
import { getRecentCropConfigs, getRecentPHIConfigs } from "./recentConfigHelpers";
import { config } from "@/config";
import type { PreprocessingEventData } from "@/store/preprocessingStore";
import type { Screenshot } from "@/types";

const IMAGE_URL_PREFIX = config.apiBaseUrl + "/screenshots";

export const PreprocessingQueueView = () => {
  const queueIndex = usePreprocessingStore((s) => s.queueIndex);
  const queueScreenshotIds = usePreprocessingStore((s) => s.queueScreenshotIds);
  const queueNext = usePreprocessingStore((s) => s.queueNext);
  const queuePrev = usePreprocessingStore((s) => s.queuePrev);
  const exitQueue = usePreprocessingStore((s) => s.exitQueue);
  const activeStage = usePreprocessingStore((s) => s.activeStage);
  const screenshots = usePreprocessingStore((s) => s.screenshots);
  const loadScreenshots = usePreprocessingStore((s) => s.loadScreenshots);
  const loadSummary = usePreprocessingStore((s) => s.loadSummary);

  const currentId = queueScreenshotIds[queueIndex];
  const currentScreenshot = useMemo(
    () => screenshots.find((s) => s.id === currentId),
    [screenshots, currentId],
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        queuePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        queueNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        exitQueue();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [queuePrev, queueNext, exitQueue]);

  const handleRefresh = () => {
    loadScreenshots();
    loadSummary();
  };

  // Hooks must be called unconditionally — compute all derived values here
  const initialCrop = useMemo(
    () => currentScreenshot ? getCropRectFromEvent(getCurrentEvent(currentScreenshot, "cropping")) : undefined,
    [currentScreenshot],
  );

  const recentCrops = useMemo(
    () => currentScreenshot ? getRecentCropConfigs(screenshots, currentScreenshot.id) : [],
    [screenshots, currentScreenshot],
  );

  const recentPHIConfigs = useMemo(
    () => currentScreenshot ? getRecentPHIConfigs(screenshots, currentScreenshot.id) : [],
    [screenshots, currentScreenshot],
  );

  if (!currentScreenshot) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <p>Screenshot not found</p>
        <button
          onClick={exitQueue}
          className="mt-4 px-4 py-2 text-sm border border-slate-300 rounded-md hover:bg-slate-50"
        >
          Back to Table
        </button>
      </div>
    );
  }

  const event = getCurrentEvent(currentScreenshot, activeStage);

  if (activeStage === "device_detection") {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        <QueueNavigationBar currentScreenshot={currentScreenshot} />
        <DeviceInfoPanel screenshot={currentScreenshot} event={event} />
      </div>
    );
  }

  if (activeStage === "cropping") {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        <QueueNavigationBar currentScreenshot={currentScreenshot} />
        <div className="flex-1 min-h-0">
          <CropAdjustModal
            key={currentScreenshot.id}
            screenshotId={currentScreenshot.id}
            isOpen={false}
            onClose={() => {}}
            onCropApplied={handleRefresh}
            initialCrop={initialCrop}
            inline
            onApplyAndNext={() => {
              handleRefresh();
              queueNext();
            }}
            recentCrops={recentCrops}
          />
        </div>
      </div>
    );
  }

  if (activeStage === "phi_detection") {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        <QueueNavigationBar currentScreenshot={currentScreenshot} />
        <div className="flex-1 min-h-0">
          <PHIRegionEditor
            key={currentScreenshot.id}
            screenshotId={currentScreenshot.id}
            isOpen={false}
            onClose={() => {}}
            onRegionsSaved={handleRefresh}
            onRedactionApplied={handleRefresh}
            inline
            onSaveAndNext={() => {
              handleRefresh();
              queueNext();
            }}
            recentPHIConfigs={recentPHIConfigs}
          />
        </div>
      </div>
    );
  }

  if (activeStage === "phi_redaction") {
    const redactEvent = getCurrentEvent(currentScreenshot, "phi_redaction");
    const phiEvent = getCurrentEvent(currentScreenshot, "phi_detection");
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        <QueueNavigationBar currentScreenshot={currentScreenshot} />
        <div className="flex-1 min-h-0">
          <RedactionReviewPanel
            key={currentScreenshot.id}
            screenshot={currentScreenshot}
            redactEvent={redactEvent}
            phiEvent={phiEvent}
            onNext={queueNext}
          />
        </div>
      </div>
    );
  }

  return null;
};

/** Read-only panel for device detection stage — shows image + metadata */
function DeviceInfoPanel({
  screenshot,
  event,
}: {
  screenshot: { id: number; participant_id?: string | null; device_type?: string | null };
  event: PreprocessingEventData | null;
}) {
  const result = event?.result as Record<string, unknown> | undefined;

  return (
    <div className="flex-1 flex overflow-hidden bg-white rounded-lg border border-slate-200 min-h-0">
      {/* Image */}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex items-center justify-center p-4">
        <img
          src={`${IMAGE_URL_PREFIX}/${screenshot.id}/image`}
          alt={`Screenshot ${screenshot.id}`}
          style={{ maxHeight: "calc(100vh - 14rem)" }}
          className="max-w-full object-contain rounded"
        />
      </div>

      {/* Metadata sidebar */}
      <div className="w-72 border-l p-4 space-y-4 overflow-y-auto">
        <h3 className="text-sm font-semibold text-slate-700">Device Detection</h3>

        {result ? (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-slate-500">Category:</span>{" "}
              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                result.device_category === "ipad"
                  ? "bg-primary-100 text-primary-700"
                  : result.device_category === "iphone"
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-600"
              }`}>
                {result.device_category as string}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Model:</span>{" "}
              <span className="text-slate-700">{(result.device_model as string) || "\u2014"}</span>
            </div>
            <div>
              <span className="text-slate-500">Confidence:</span>{" "}
              <span className={`font-mono ${
                (result.confidence as number) >= 0.9
                  ? "text-green-600"
                  : (result.confidence as number) >= 0.7
                    ? "text-yellow-600"
                    : "text-red-600"
              }`}>
                {Math.round((result.confidence as number) * 100)}%
              </span>
            </div>
            {result.orientation ? (
              <div>
                <span className="text-slate-500">Orientation:</span>{" "}
                <span className="text-slate-700">{String(result.orientation)}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No detection data available</p>
        )}
      </div>
    </div>
  );
}

/** Before/after panel for redaction review — shows final redacted image + metadata */
function RedactionReviewPanel({
  screenshot,
  redactEvent,
  phiEvent,
  onNext,
}: {
  screenshot: Screenshot;
  redactEvent: PreprocessingEventData | null;
  phiEvent: PreprocessingEventData | null;
  onNext: () => void;
}) {
  const redactResult = redactEvent?.result as Record<string, unknown> | undefined;
  const phiResult = phiEvent?.result as Record<string, unknown> | undefined;
  const regions = (phiResult?.regions ?? []) as Array<Record<string, unknown>>;
  const wasRedacted = redactResult?.redacted === true;
  const regionsRedacted = (redactResult?.regions_redacted as number) ?? 0;
  const method = (redactResult?.method as string) ?? "unknown";

  // "after" = current file_path (redacted), "before" = cropping stage output
  const afterUrl = `${IMAGE_URL_PREFIX}/${screenshot.id}/image`;
  const beforeUrl = `${IMAGE_URL_PREFIX}/${screenshot.id}/stage-image?stage=cropping`;

  const [view, setView] = useState<"after" | "before">("after");

  // Bust cache using redaction event ID (changes on each re-run)
  const redactEid = (redactEvent as Record<string, unknown> | undefined)?.event_id ?? screenshot.id;
  const cacheBuster = `?t=${redactEid}`;

  return (
    <div className="flex-1 flex overflow-hidden bg-white rounded-lg border border-slate-200 min-h-0">
      {/* Image area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Before/After toggle */}
        {wasRedacted && (
          <div className="flex items-center gap-2 px-4 py-2 border-b bg-slate-50 shrink-0">
            <span className="text-xs text-slate-500 mr-1">View:</span>
            <button
              onClick={() => setView("after")}
              className={`px-3 py-1 text-xs rounded font-medium ${
                view === "after"
                  ? "bg-orange-100 text-orange-700 ring-1 ring-orange-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Redacted
            </button>
            <button
              onClick={() => setView("before")}
              className={`px-3 py-1 text-xs rounded font-medium ${
                view === "before"
                  ? "bg-primary-100 text-primary-700 ring-1 ring-primary-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Original
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center p-4">
          <img
            src={`${view === "after" ? afterUrl : beforeUrl}${cacheBuster}`}
            alt={`Screenshot ${screenshot.id} — ${view === "after" ? "redacted" : "original"}`}
            style={{ maxHeight: "calc(100vh - 15rem)" }}
            className="max-w-full object-contain rounded"
          />
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-72 border-l flex flex-col">
        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-700">Redaction Result</h3>

          <div className="space-y-3 text-sm">
            <div>
              <span className="text-slate-500">Status:</span>{" "}
              {wasRedacted ? (
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                  Redacted
                </span>
              ) : (
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                  No redaction needed
                </span>
              )}
            </div>
            <div>
              <span className="text-slate-500">Regions redacted:</span>{" "}
              <span className="font-mono">{regionsRedacted}</span>
            </div>
            <div>
              <span className="text-slate-500">Method:</span>{" "}
              <span className="text-slate-700">{method}</span>
            </div>
          </div>

          {/* Region list from phi_detection */}
          {regions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 mb-2">PHI Regions</h4>
              <div className="space-y-1">
                {regions.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-slate-50">
                    <span className="font-mono text-slate-400 w-4">{i + 1}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      String(r.source) === "manual" ? "bg-primary-100 text-primary-600" : "bg-red-100 text-red-600"
                    }`}>
                      {String(r.label || r.type || "?")}
                    </span>
                    <span className="text-slate-500 truncate flex-1" title={String(r.text || "")}>
                      {String(r.text || "\u2014")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!redactEvent && (
            <p className="text-sm text-slate-400">Redaction has not been run yet for this screenshot.</p>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t space-y-2">
          <button
            onClick={() => onNext()}
            className="w-full px-3 py-2 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
