import { useCallback, useMemo, useEffect, useRef } from "react";
import type { GridCoordinates } from "@/core";
import {
  useScreenshotService,
  useAnnotationService,
  useConsensusService,
} from "@/core";
import { createAnnotationStore } from "@/store/createAnnotationStore";
import { VerifiedScreenshotError } from "@/store/slices/processingSlice";
import toast from "react-hot-toast";
import { toastErrorWithRetry } from "@/utils/toastWithRetry";
import { config } from "@/config";

// Store instances keyed by groupId + processingStatus (undefined = no filter)
// Each entry tracks the store and its reference count
interface StoreEntry {
  store: ReturnType<typeof createAnnotationStore>;
  refCount: number;
}
const storeInstances = new Map<string, StoreEntry>();

// Cleanup delay to allow for quick re-mounts (e.g., React strict mode)
const CLEANUP_DELAY_MS = 5000;

export const useAnnotation = (groupId?: string, processingStatus?: string) => {
  const screenshotService = useScreenshotService();
  const annotationService = useAnnotationService();
  const consensusService = useConsensusService();

  // Track the cache key for cleanup
  const cacheKeyRef = useRef<string | null>(null);

  const store = useMemo(() => {
    // Use groupId + processingStatus as key
    const cacheKey = `${groupId || ""}:${processingStatus || ""}`;
    cacheKeyRef.current = cacheKey;

    const existing = storeInstances.get(cacheKey);
    if (existing) {
      existing.refCount++;
      return existing.store;
    }

    const newStore = createAnnotationStore(
      screenshotService,
      annotationService,
      consensusService,
      groupId,
      processingStatus,
    );
    storeInstances.set(cacheKey, { store: newStore, refCount: 1 });
    return newStore;
  }, [
    screenshotService,
    annotationService,
    consensusService,
    groupId,
    processingStatus,
  ]);

  // Cleanup store when component unmounts
  useEffect(() => {
    const currentKey = cacheKeyRef.current;

    return () => {
      if (!currentKey) return;

      // Delayed cleanup to handle React strict mode double-mount
      setTimeout(() => {
        const entry = storeInstances.get(currentKey);
        if (entry) {
          entry.refCount--;
          if (entry.refCount <= 0) {
            storeInstances.delete(currentKey);
            if (config.isDev) {
              console.log(
                `[useAnnotation] Cleaned up store for key: ${currentKey}`,
              );
            }
          }
        }
      }, CLEANUP_DELAY_MS);
    };
  }, [groupId, processingStatus]);

  const {
    currentScreenshot,
    currentAnnotation,
    consensus,
    queueStats,
    isLoading,
    noScreenshots,
    error,
    processingIssues,
    isAutoProcessed,
    loadNextScreenshot,
    loadScreenshot,
    loadQueueStats,
    setGridCoordinates,
    setHourlyValues,
    updateHourValue,
    setExtractedTitle,
    submitAnnotation,
    skipScreenshot,
    reprocessWithGrid: storeReprocessWithGrid,
    reprocessWithLineBased: storeReprocessWithLineBased,
    reprocessWithOcrAnchored: storeReprocessWithOcrAnchored,
    clearError,
    // NEW: Progress tracking
    processingProgress,
    isTesseractInitialized,
    isInitializingTesseract,
    setProcessingProgress,
    clearProcessingProgress,
    setTesseractInitialized,
    setInitializingTesseract,
    // NEW: Navigation state
    currentIndex,
    totalInFilter,
    hasNext,
    hasPrev,
    screenshotList,
    verificationFilter,
    // NEW: Navigation actions
    navigateNext,
    navigatePrev,
    loadScreenshotList,
    setVerificationFilter,
    // NEW: Verification actions
    verifyCurrentScreenshot,
    unverifyCurrentScreenshot,
    // OCR recalculation
    recalculateOcrTotal,
    // Grid optimization
    maxShift,
    setMaxShift,
  } = store();

  const handleSubmit = useCallback(
    async (notes?: string) => {
      try {
        if (config.isDev) {
          console.log("[useAnnotation.handleSubmit] Starting submission...");
        }
        await submitAnnotation(notes);
        toast.success("Annotation submitted successfully!");
        if (config.isDev) {
          console.log("[useAnnotation.handleSubmit] Loading next screenshot...");
        }
        await loadNextScreenshot();
        if (config.isDev) {
          console.log("[useAnnotation.handleSubmit] Next screenshot loaded");
        }
      } catch (err: unknown) {
        console.error("[useAnnotation.handleSubmit] Error:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Failed to submit annotation";
        toastErrorWithRetry({
          message: errorMessage,
          // eslint-disable-next-line react-hooks/immutability
          onRetry: () => handleSubmit(notes),
          retryLabel: "Retry Submit",
        });
      }
    },
    [submitAnnotation, loadNextScreenshot],
  );

  // Save without navigating (for auto-save)
  const handleSaveOnly = useCallback(
    async (notes?: string) => {
      try {
        await submitAnnotation(notes);
      } catch (err: unknown) {
        console.error("[useAnnotation.handleSaveOnly] Error:", err);
        throw err;
      }
    },
    [submitAnnotation],
  );

  const handleSkip = useCallback(async () => {
    try {
      if (config.isDev) {
        console.log("[useAnnotation.handleSkip] Starting skip...");
      }
      await skipScreenshot();
      toast.success("Screenshot skipped");
      if (config.isDev) {
        console.log("[useAnnotation.handleSkip] Skip completed");
      }
    } catch (err: unknown) {
      console.error("[useAnnotation.handleSkip] Error:", err);
      const errorMessage =
        err instanceof Error ? err.message : "Failed to skip screenshot";
      toastErrorWithRetry({
        message: errorMessage,
        // eslint-disable-next-line react-hooks/immutability
        onRetry: handleSkip,
        retryLabel: "Retry Skip",
      });
    }
  }, [skipScreenshot]);

  const handleSetGrid = useCallback(
    (coords: GridCoordinates) => {
      setGridCoordinates(coords);
    },
    [setGridCoordinates],
  );

  const handleReprocessWithGrid = useCallback(
    async (coords: GridCoordinates) => {
      try {
        await storeReprocessWithGrid(coords);
      } catch (error) {
        if (error instanceof VerifiedScreenshotError) {
          toast.error("Cannot reprocess: you have already verified this screenshot");
        } else {
          throw error;
        }
      }
    },
    [storeReprocessWithGrid],
  );

  const handleReprocessWithLineBased = useCallback(async () => {
    try {
      await storeReprocessWithLineBased();
    } catch (error) {
      if (error instanceof VerifiedScreenshotError) {
        toast.error("Cannot reprocess: you have already verified this screenshot");
      } else {
        throw error;
      }
    }
  }, [storeReprocessWithLineBased]);

  const handleReprocessWithOcrAnchored = useCallback(async () => {
    try {
      await storeReprocessWithOcrAnchored();
    } catch (error) {
      if (error instanceof VerifiedScreenshotError) {
        toast.error("Cannot reprocess: you have already verified this screenshot");
      } else {
        throw error;
      }
    }
  }, [storeReprocessWithOcrAnchored]);

  return {
    screenshot: currentScreenshot,
    annotation: currentAnnotation,
    consensus,
    queueStats,
    isLoading,
    noScreenshots,
    error,
    processingIssues,
    isAutoProcessed,
    loadNext: loadNextScreenshot,
    loadById: loadScreenshot,
    loadQueueStats,
    setGrid: handleSetGrid,
    setHourlyValues,
    updateHour: updateHourValue,
    setTitle: setExtractedTitle,
    submit: handleSubmit,
    saveOnly: handleSaveOnly,
    skip: handleSkip,
    reprocessWithGrid: handleReprocessWithGrid,
    reprocessWithLineBased: handleReprocessWithLineBased,
    reprocessWithOcrAnchored: handleReprocessWithOcrAnchored,
    clearError,
    // NEW: Progress tracking
    processingProgress,
    isTesseractInitialized,
    isInitializingTesseract,
    setProcessingProgress,
    clearProcessingProgress,
    setTesseractInitialized,
    setInitializingTesseract,
    // NEW: Navigation
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
    // NEW: Verification
    verifyCurrentScreenshot,
    unverifyCurrentScreenshot,
    // OCR recalculation
    recalculateOcrTotal,
    // Grid optimization
    maxShift,
    setMaxShift,
  };
};
