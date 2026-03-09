import { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router";
import { useAnnotation } from "@/hooks/useAnnotationWithDI";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useGridProcessing } from "@/hooks/useGridProcessing";
import { useAuth } from "@/hooks/useAuth";
import { GridSelector } from "./GridSelector";
import { CroppedGraphViewer } from "./CroppedGraphViewer";
import { HourlyUsageEditor } from "./HourlyUsageEditor";
import { HourlyUsageOverlay } from "./HourlyUsageOverlay";
import { IssueDisplay } from "./IssueDisplay";
import { DuplicateWarning } from "./DuplicateWarning";
import { ScreenshotSelector } from "./ScreenshotSelector";
import { VerificationFilter } from "./VerificationFilter";
import { ProcessingStatusFilter } from "./ProcessingStatusFilter";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { TotalsDisplay } from "./TotalsDisplay";
import { AlignmentWarning } from "./AlignmentWarning";
import type { ProcessingStatus } from "@/types";
import type { ProcessingStatus as FilterProcessingStatus } from "@/constants/processingStatus";
import { PreprocessingSummary } from "./PreprocessingSummary";
import { useScreenshotImage } from "@/hooks/useScreenshotImage";
import toast from "react-hot-toast";

type ProcessingMethod = "ocr_anchored" | "line_based";

export type GraphDisplayMode = "separate" | "overlay";

interface AnnotationWorkspaceProps {
  groupId?: string;
  processingStatus?: ProcessingStatus;
  initialScreenshotId?: number;
}

export const AnnotationWorkspace = ({
  groupId,
  processingStatus,
  initialScreenshotId,
}: AnnotationWorkspaceProps) => {
  const navigate = useNavigate();
  const { username } = useAuth();
  const {
    screenshot,
    annotation,
    isLoading,
    noScreenshots,
    processingIssues,
    loadNext,
    loadById,
    updateHour,
    saveOnly,
    skip,
    reprocessWithGrid,
    setGrid,
    setTitle,
    currentIndex,
    totalInFilter,
    hasNext,
    hasPrev,
    screenshotList,
    verificationFilter,
    navigateNext,
    navigatePrev,
    loadScreenshotList,
    setVerificationFilter,
    verifyCurrentScreenshot,
    unverifyCurrentScreenshot,
    recalculateOcrTotal,
    reprocessWithLineBased,
    reprocessWithOcrAnchored,
    maxShift,
    setMaxShift,
  } = useAnnotation(groupId, processingStatus);

  const imageUrl = useScreenshotImage(screenshot?.id || 0);

  const [notes, setNotes] = useState("");
  const [displayMode, setDisplayMode] = useState<GraphDisplayMode>("overlay");
  const [isRecalculatingOcr, setIsRecalculatingOcr] = useState(false);
  const [reprocessingMethod, setReprocessingMethod] =
    useState<ProcessingMethod | null>(null);

  // Check if THIS USER has verified the screenshot (read-only mode for them)
  // Use username-based check as it's more reliable than userId which can get stale
  const isVerifiedByMe = !!(
    username &&
    screenshot?.verified_by_usernames?.includes(username)
  );

  // Get ALL verifiers' usernames
  const allVerifierUsernames = screenshot?.verified_by_usernames || [];

  // Grid processing hook with debounce
  const { isProcessing, handleGridSelect } = useGridProcessing({
    onReprocess: reprocessWithGrid,
    onSetGrid: setGrid,
  });

  // Auto-save hook
  const gridCoordsValid =
    annotation?.grid_coords &&
    !(
      annotation.grid_coords.upper_left.x === 0 &&
      annotation.grid_coords.lower_right.x === 0
    );

  const { isSaving, lastSaved, timeSinceLastSave } = useAutoSave({
    screenshotId: screenshot?.id,
    hourlyData: annotation?.hourly_values,
    extractedTitle: screenshot?.extracted_title,
    gridCoordsValid: !!gridCoordsValid,
    notes,
    onSave: saveOnly,
  });

  // Initial load
  useEffect(() => {
    if (initialScreenshotId) {
      loadById(initialScreenshotId);
    } else {
      loadNext();
    }
    loadScreenshotList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, processingStatus, initialScreenshotId]);
  // Note: loadById, loadNext, loadScreenshotList are stable Zustand store functions

  // Update URL when screenshot changes
  useEffect(() => {
    if (screenshot?.id) {
      const searchParams = new URLSearchParams();
      if (groupId) searchParams.set("group", groupId);
      if (processingStatus)
        searchParams.set("processing_status", processingStatus);
      const search = searchParams.toString();
      const newUrl = `/annotate/${screenshot.id}${search ? `?${search}` : ""}`;
      navigate(newUrl, { replace: true });
    }
  }, [screenshot?.id, groupId, processingStatus, navigate]);
  // Note: navigate is stable from react-router-dom

  const handleRecalculateOcr = useCallback(async () => {
    if (isRecalculatingOcr) return;
    setIsRecalculatingOcr(true);
    try {
      const newTotal = await recalculateOcrTotal();
      if (newTotal) {
        toast.success(`OCR total updated: ${newTotal}`);
      } else {
        toast.error("Could not extract OCR total");
      }
    } catch (error) {
      toast.error("Failed to recalculate OCR total");
    } finally {
      setIsRecalculatingOcr(false);
    }
  }, [recalculateOcrTotal, isRecalculatingOcr]);

  const handleReprocess = useCallback(
    async (method: ProcessingMethod) => {
      if (reprocessingMethod) return;
      setReprocessingMethod(method);
      try {
        if (method === "line_based") {
          await reprocessWithLineBased();
          toast.success("Line-based detection completed");
        } else {
          await reprocessWithOcrAnchored();
          toast.success("OCR-anchored detection completed");
        }
      } catch (error) {
        const methodName =
          method === "line_based" ? "Line-based" : "OCR-anchored";
        const message =
          error instanceof Error
            ? error.message
            : `${methodName} detection failed`;
        toast.error(message);
      } finally {
        setReprocessingMethod(null);
      }
    },
    [reprocessWithLineBased, reprocessWithOcrAnchored, reprocessingMethod],
  );

  const handleVerificationToggle = useCallback(async () => {
    if (!screenshot) return;
    if (isVerifiedByMe) {
      try {
        await unverifyCurrentScreenshot();
        toast.success("Your verification removed");
      } catch (error) {
        console.error("[handleVerificationToggle] Unverify failed:", error);
        toast.error("Failed to remove verification");
      }
    } else {
      // Check if title is required and missing
      if (
        screenshot.image_type === "screen_time" &&
        !screenshot.extracted_title
      ) {
        toast.error("Cannot verify: App/Title is required");
        return;
      }
      try {
        await verifyCurrentScreenshot();
        toast.success("Screenshot verified by you");
      } catch (error) {
        console.error("[handleVerificationToggle] Verify failed:", error);
        toast.error("Failed to verify screenshot");
      }
    }
  }, [
    screenshot,
    isVerifiedByMe,
    verifyCurrentScreenshot,
    unverifyCurrentScreenshot,
  ]);

  // Handler for changing processing status filter
  const handleProcessingStatusChange = useCallback(
    (newStatus: ProcessingStatus | "all") => {
      const searchParams = new URLSearchParams();
      if (groupId) searchParams.set("group", groupId);
      if (newStatus !== "all") searchParams.set("processing_status", newStatus);
      const search = searchParams.toString();
      navigate(`/annotate${search ? `?${search}` : ""}`, { replace: false });
    },
    [groupId, navigate]
  );

  useKeyboardShortcuts([
    {
      key: "Escape",
      handler: () => {
        if (!isLoading) skip();
      },
    },
    {
      key: "ArrowLeft",
      handler: () => {
        if (!isLoading && hasPrev) navigatePrev();
      },
    },
    {
      key: "ArrowRight",
      handler: () => {
        if (!isLoading && hasNext) navigateNext();
      },
    },
    {
      key: "v",
      handler: handleVerificationToggle,
    },
  ]);

  if (noScreenshots) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">All Done!</div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            No Screenshots in Queue
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            {groupId ? (
              <>No screenshots match the current filter for group <span className="font-semibold">{groupId}</span>.</>
            ) : (
              "No screenshots match the current filter."
            )}
          </p>

          {/* Filter controls */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 space-y-4 text-left">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 font-medium">Processing Status</div>
              <ProcessingStatusFilter
                value={(processingStatus as FilterProcessingStatus) || "all"}
                onChange={handleProcessingStatusChange}
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 font-medium">Verification Status</div>
              <VerificationFilter
                value={verificationFilter}
                onChange={setVerificationFilter}
              />
            </div>
          </div>

          <button
            onClick={() => navigate("/")}
            className="mt-6 px-4 py-2 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            Back to Groups
          </button>
        </div>
      </div>
    );
  }

  if (!screenshot) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading screenshot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1 h-full" data-testid="annotation-workspace">
      {/* Left Column - Grid Selector */}
      <div className="flex-1">
        <div className="bg-white dark:bg-slate-800 h-full p-1 flex items-center justify-center relative">
          <div className="w-full max-w-xl">
            <GridSelector
              imageUrl={imageUrl || ""}
              onGridSelect={handleGridSelect}
              initialCoords={annotation?.grid_coords}
              disabled={isVerifiedByMe}
              imageType={screenshot.image_type}
              extractedTitle={screenshot.extracted_title}
              onTitleChange={setTitle}
              data-testid="grid-selector"
            />
          </div>
        </div>
      </div>

      {/* Center Column - Cropped Graph + Hourly Bars */}
      <div className="flex-[2]">
        <div className="bg-white dark:bg-slate-800 h-full flex flex-col relative">
          {/* Screenshot metadata header */}
          <div className="bg-slate-100 dark:bg-slate-700 px-4 py-2 rounded-t text-sm flex-shrink-0 border-b border-slate-200 dark:border-slate-600 text-center space-y-1">
            <div className="flex items-center justify-center gap-4 text-slate-700 dark:text-slate-300">
              {screenshot.group_id && (
                <span><span className="font-semibold text-slate-500">Group:</span> {screenshot.group_id}</span>
              )}
              {processingStatus && (
                <span><span className="font-semibold text-slate-500">Subgroup:</span> <span className="capitalize">{processingStatus}</span></span>
              )}
              {screenshot.participant_id && (
                <span><span className="font-semibold text-slate-500">ID:</span> {screenshot.participant_id}</span>
              )}
              {screenshot.screenshot_date && (
                <span><span className="font-semibold text-slate-500">Date:</span> {screenshot.screenshot_date}</span>
              )}
              <span className="text-slate-400 font-mono">#{screenshot.id}</span>
            </div>
            {screenshot.original_filepath && (
              <div className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-500">Source:</span> {screenshot.original_filepath}
              </div>
            )}
          </div>
          {/* Preprocessing status banner */}
          {(() => {
            const pp = (screenshot.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
            const stageStatus = pp?.stage_status as Record<string, string> | undefined;
            if (!stageStatus) return null;
            const problemStages = Object.entries(stageStatus).filter(
              ([, st]) => st === "invalidated" || st === "failed",
            );
            if (problemStages.length === 0) return null;
            const stageNames = problemStages.map(([s]) => s.replace(/_/g, " ")).join(", ");
            return (
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm flex items-center gap-2">
                <span className="text-amber-600">
                  Preprocessing issue: {stageNames} {problemStages.length === 1 ? "is" : "are"} {problemStages[0]![1]}.
                </span>
                <Link
                  to={`/preprocessing?screenshot_id=${screenshot.id}&returnUrl=${encodeURIComponent(`/annotate/${screenshot.id}`)}`}
                  className="text-primary-600 hover:text-primary-800 underline text-xs font-medium"
                >
                  Fix in Preprocessing &rarr;
                </Link>
              </div>
            );
          })()}
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            <div className="w-full">
              {displayMode === "overlay" ? (
                <HourlyUsageOverlay
                  data={annotation?.hourly_values || {}}
                  onChange={updateHour}
                  imageUrl={imageUrl || ""}
                  gridCoords={annotation?.grid_coords || null}
                  readOnly={isVerifiedByMe}
                />
              ) : (
                <>
                  <CroppedGraphViewer
                    imageUrl={imageUrl || ""}
                    gridCoords={annotation?.grid_coords || null}
                    targetWidth={800}
                  />
                  <HourlyUsageEditor
                    data={annotation?.hourly_values || {}}
                    onChange={updateHour}
                    readOnly={isVerifiedByMe}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Column - Info Panel */}
      <div className="flex-1">
        <div className="bg-white dark:bg-slate-800 p-2 h-full flex items-center justify-center">
          <div className="w-full space-y-2 overflow-y-auto max-h-full px-1">
            {/* Screenshot Navigator */}
            <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
              <ScreenshotSelector
                currentScreenshot={screenshot}
                screenshotList={screenshotList}
                currentIndex={currentIndex}
                totalInFilter={totalInFilter}
                hasNext={hasNext}
                hasPrev={hasPrev}
                onNavigateNext={navigateNext}
                onNavigatePrev={navigatePrev}
                onSelectScreenshot={loadById}
                onSearch={(search) => loadScreenshotList({ search })}
                isLoading={isLoading}
                currentUsername={username}
              />
            </div>

            {/* Filters */}
            <div className="border-b border-slate-100 dark:border-slate-700 pb-2 space-y-2">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Status</div>
                <ProcessingStatusFilter
                  value={(processingStatus as FilterProcessingStatus) || "all"}
                  onChange={handleProcessingStatusChange}
                />
              </div>
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Verified</div>
                <VerificationFilter
                  value={verificationFilter}
                  onChange={setVerificationFilter}
                />
              </div>
            </div>

            {/* Alignment Score Warning */}
            <AlignmentWarning alignmentScore={screenshot.alignment_score} />

            {/* Preprocessing Summary */}
            <PreprocessingSummary processingMetadata={screenshot.processing_metadata} />

            {/* Totals Display */}
            <TotalsDisplay
              ocrTotal={screenshot.extracted_total}
              hourlyData={annotation?.hourly_values || {}}
              isProcessing={isProcessing}
              onRecalculateOcr={handleRecalculateOcr}
              isRecalculatingOcr={isRecalculatingOcr}
              showRecalculateButton={
                !isVerifiedByMe && screenshot.image_type === "screen_time"
              }
            />

            {/* View Mode Toggle */}
            <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">View</div>
              <div className="flex gap-1">
                <button
                  onClick={() => setDisplayMode("overlay")}
                  className={`flex-1 px-2 py-1 text-xs rounded ${
                    displayMode === "overlay"
                      ? "bg-primary-600 text-white"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  }`}
                >
                  Overlay
                </button>
                <button
                  onClick={() => setDisplayMode("separate")}
                  className={`flex-1 px-2 py-1 text-xs rounded ${
                    displayMode === "separate"
                      ? "bg-primary-600 text-white"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                  }`}
                >
                  Separate
                </button>
              </div>
            </div>

            {/* Potential Duplicate Warning */}
            {screenshot?.potential_duplicate_of && (
              <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
                <DuplicateWarning
                  duplicateId={screenshot.potential_duplicate_of}
                  onSkipThis={async () => {
                    await skip();
                  }}
                  onGoToDuplicate={() => {
                    if (screenshot?.potential_duplicate_of) {
                      loadById(screenshot.potential_duplicate_of);
                    }
                  }}
                  isLoading={isLoading}
                />
              </div>
            )}

            {/* Issues */}
            {processingIssues && processingIssues.length > 0 && (
              <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
                <IssueDisplay issues={processingIssues} />
              </div>
            )}

            {/* Reprocessing Buttons */}
            <div
              className={`border-b border-slate-100 dark:border-slate-700 pb-2 ${isVerifiedByMe ? "opacity-50" : ""}`}
            >
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Reprocess Grid</div>

              {/* Grid Optimization Spinner - centered */}
              <div className="flex flex-col items-center mb-2">
                <div
                  className="text-xs text-slate-400 dark:text-slate-500 mb-1 text-center cursor-help"
                  title="Shifts grid boundaries by ±N pixels to match bar total with OCR total. Higher = slower but more likely to find exact match."
                >
                  Grid Optimization Shift Range
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setMaxShift(Math.max(0, maxShift - 1))}
                    disabled={isVerifiedByMe || maxShift <= 0}
                    className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Decrease optimization range"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div
                    className="flex items-center border dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 cursor-help"
                    title="Max pixels to shift grid boundaries in each direction"
                  >
                    <span className="text-xs font-mono w-8 text-center">±{maxShift}</span>
                  </div>
                  <button
                    onClick={() => setMaxShift(Math.min(10, maxShift + 1))}
                    disabled={isVerifiedByMe || maxShift >= 10}
                    className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-300 dark:hover:bg-slate-600 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Increase optimization range"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <span className="text-xs text-slate-400 ml-1">px</span>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleReprocess("ocr_anchored")}
                  disabled={
                    isVerifiedByMe || reprocessingMethod !== null || isLoading
                  }
                  className={`flex-1 py-2 px-2 text-xs border rounded flex items-center justify-center gap-1 ${
                    screenshot?.processing_method === "ocr_anchored"
                      ? "bg-purple-100 text-purple-800 border-purple-300"
                      : "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={
                    isVerifiedByMe
                      ? "Unverify to reprocess"
                      : "Reprocess using OCR text anchors"
                  }
                >
                  {reprocessingMethod === "ocr_anchored" ? (
                    <div className="animate-spin h-3 w-3 border-2 border-purple-600 border-t-transparent rounded-full" />
                  ) : (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  )}
                  OCR
                </button>
                <button
                  onClick={() => handleReprocess("line_based")}
                  disabled={
                    isVerifiedByMe || reprocessingMethod !== null || isLoading
                  }
                  className={`flex-1 py-2 px-2 text-xs border rounded flex items-center justify-center gap-1 ${
                    screenshot?.processing_method === "line_based"
                      ? "bg-primary-100 text-primary-800 border-primary-300"
                      : "bg-primary-50 text-primary-700 border-primary-200 hover:bg-primary-100"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={
                    isVerifiedByMe
                      ? "Unverify to reprocess"
                      : "Reprocess using visual line detection"
                  }
                >
                  {reprocessingMethod === "line_based" ? (
                    <div className="animate-spin h-3 w-3 border-2 border-primary-600 border-t-transparent rounded-full" />
                  ) : (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                  )}
                  Lines
                </button>
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 text-center">
                {isVerifiedByMe
                  ? "Verified (read-only)"
                  : screenshot?.processing_method
                    ? `Current: ${screenshot.processing_method === "ocr_anchored" ? "OCR" : screenshot.processing_method === "line_based" ? "Lines" : screenshot.processing_method}`
                    : "Click to detect grid"}
              </div>
            </div>

            {/* Notes */}
            <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Notes</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none dark:bg-slate-700 dark:text-slate-200"
                placeholder="Optional notes..."
                rows={2}
              />
            </div>

            {/* Action Buttons */}
            <div className="pt-2 space-y-2">
              {/* Verify Button */}
              {(() => {
                const isMissingTitle =
                  screenshot.image_type === "screen_time" &&
                  !screenshot.extracted_title;
                const canVerify = !isMissingTitle || isVerifiedByMe;
                return (
                  <button
                    onClick={handleVerificationToggle}
                    disabled={!canVerify}
                    data-testid={isVerifiedByMe ? "unverify-button" : "verify-button"}
                    title={
                      isMissingTitle && !isVerifiedByMe
                        ? "Cannot verify: App/Title is required"
                        : undefined
                    }
                    className={`w-full py-2 text-sm font-medium rounded transition-colors ${
                      isVerifiedByMe
                        ? "bg-green-600 text-white hover:bg-green-700"
                        : canVerify
                          ? "bg-green-100 text-green-700 hover:bg-green-200 border border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 dark:border-green-700"
                          : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500 dark:border-slate-600"
                    }`}
                  >
                    {isVerifiedByMe
                      ? "Verified (V to undo)"
                      : isMissingTitle
                        ? "Title required to verify"
                        : "Mark as Verified (V)"}
                  </button>
                );
              })()}

              {/* Verifiers Info */}
              {allVerifierUsernames.length > 0 && (
                <div className="text-xs text-center text-primary-700 bg-primary-50 rounded py-1">
                  Verified by: {allVerifierUsernames.join(", ")}
                </div>
              )}

              {/* Skip Button */}
              <button
                onClick={skip}
                disabled={isLoading}
                className="w-full py-2 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                title="Skip this screenshot"
              >
                Skip (Esc)
              </button>

              {/* Auto-save Status */}
              <SaveStatusIndicator
                isSaving={isSaving}
                lastSaved={lastSaved}
                timeSinceLastSave={timeSinceLastSave}
              />

              <div className="text-xs text-slate-400 dark:text-slate-500 text-center space-y-1">
                <div>
                  <strong>←/→</strong> navigate | <strong>V</strong> verify |{" "}
                  <strong>Esc</strong> skip
                </div>
                <div>
                  <strong>WASD</strong> move grid | <strong>Shift+WASD</strong>{" "}
                  move 10px | <strong>Ctrl+WASD</strong> resize
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
