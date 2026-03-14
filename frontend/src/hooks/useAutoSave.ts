import { useEffect, useRef, useState, useCallback } from "react";

interface UseAutoSaveOptions {
  screenshotId: number | undefined;
  hourlyData: Record<string, number> | undefined;
  extractedTitle: string | null | undefined;
  gridCoordsValid: boolean;
  notes: string;
  onSave: (notes: string) => Promise<void>;
}

interface UseAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  timeSinceLastSave: string;
  /** Number of consecutive save failures. Resets on success or screenshot change. */
  saveFailCount: number;
  /** Last error message from a failed save attempt. */
  lastError: string | null;
  /** True if there are unsaved changes (edits made since last successful save). */
  hasUnsavedChanges: boolean;
  /** Manually trigger a save (e.g., from a "Retry" button). */
  retrySave: () => void;
}

export function useAutoSave(options: UseAutoSaveOptions): UseAutoSaveReturn {
  const { screenshotId, hourlyData, extractedTitle, gridCoordsValid, notes, onSave } = options;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [timeSinceLastSave, setTimeSinceLastSave] = useState<string>("");
  const [saveFailCount, setSaveFailCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track previous values to only save on actual changes (not on initial load or navigation)
  const prevHourlyDataRef = useRef<string>("");
  const prevTitleRef = useRef<string | null | undefined>(undefined);
  const prevScreenshotIdRef = useRef<number | null>(null);
  // Guard against concurrent saves; pendingSaveRef triggers a re-save after completion
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  // Stable ref for notes so it doesn't trigger re-saves
  const notesRef = useRef(notes);
  notesRef.current = notes;
  // Stable ref for onSave to avoid dependency churn
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Serialize hourly_data to detect deep changes
  const hourlyDataJson = JSON.stringify(hourlyData || {});

  // Reset save status when screenshot changes
  useEffect(() => {
    setLastSaved(null);
    setTimeSinceLastSave("");
    setSaveFailCount(0);
    setLastError(null);
    setHasUnsavedChanges(false);
  }, [screenshotId]);

  // Update time since last save every second
  useEffect(() => {
    if (!lastSaved) {
      setTimeSinceLastSave("");
      return;
    }

    const updateTime = () => {
      const now = new Date();
      const diffMs = now.getTime() - lastSaved.getTime();
      const diffSeconds = Math.floor(diffMs / 1000);

      if (diffSeconds < 5) {
        setTimeSinceLastSave("just now");
      } else if (diffSeconds < 60) {
        setTimeSinceLastSave(`${diffSeconds}s ago`);
      } else if (diffSeconds < 3600) {
        const minutes = Math.floor(diffSeconds / 60);
        setTimeSinceLastSave(`${minutes}m ago`);
      } else {
        const hours = Math.floor(diffSeconds / 3600);
        setTimeSinceLastSave(`${hours}h ago`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [lastSaved]);

  const doSave = useCallback(async () => {
    if (isSavingRef.current) {
      // Another save is in-flight — mark pending so it re-saves after completion
      pendingSaveRef.current = true;
      return;
    }
    isSavingRef.current = true;
    pendingSaveRef.current = false;
    setIsSaving(true);
    try {
      await onSaveRef.current(notesRef.current);
      setLastSaved(new Date());
      setSaveFailCount(0);
      setLastError(null);
      setHasUnsavedChanges(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed";
      console.error("[AutoSave] Failed:", message);
      setSaveFailCount((c) => c + 1);
      setLastError(message);
      // hasUnsavedChanges stays true — user needs to know
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
      // If data changed while we were saving, save again with latest state
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        doSave();
      }
    }
  }, []);

  // Auto-save effect — fires on hourly data or title changes
  useEffect(() => {
    if (!screenshotId || !gridCoordsValid || !hourlyData) {
      return;
    }

    // Don't save if no hourly data
    if (Object.keys(hourlyData).length === 0) {
      return;
    }

    // If screenshot changed, just update refs without saving (data was just loaded)
    if (prevScreenshotIdRef.current !== screenshotId) {
      prevScreenshotIdRef.current = screenshotId;
      prevHourlyDataRef.current = hourlyDataJson;
      prevTitleRef.current = extractedTitle;
      return;
    }

    // Check if actual edits were made
    const hourlyDataChanged = prevHourlyDataRef.current !== hourlyDataJson;
    const titleChanged = prevTitleRef.current !== extractedTitle;

    // Update refs for next comparison
    prevHourlyDataRef.current = hourlyDataJson;
    prevTitleRef.current = extractedTitle;

    // Only save if something actually changed
    if (!hourlyDataChanged && !titleChanged) {
      return;
    }

    setHasUnsavedChanges(true);
    doSave();
    // notes and onSave excluded — we use refs for both to avoid triggering re-saves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourlyDataJson, screenshotId, extractedTitle, gridCoordsValid, hourlyData, doSave]);

  const retrySave = useCallback(() => {
    doSave();
  }, [doSave]);

  return {
    isSaving,
    lastSaved,
    timeSinceLastSave,
    saveFailCount,
    lastError,
    hasUnsavedChanges,
    retrySave,
  };
}
