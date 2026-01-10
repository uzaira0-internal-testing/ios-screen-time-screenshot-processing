import { useEffect, useRef, useState } from "react";

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
}

export function useAutoSave(options: UseAutoSaveOptions): UseAutoSaveReturn {
  const { screenshotId, hourlyData, extractedTitle, gridCoordsValid, notes, onSave } = options;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [timeSinceLastSave, setTimeSinceLastSave] = useState<string>("");

  // Track previous values to only save on actual changes (not on initial load or navigation)
  const prevHourlyDataRef = useRef<string>("");
  const prevTitleRef = useRef<string | null | undefined>(undefined);
  const prevScreenshotIdRef = useRef<number | null>(null);

  // Serialize hourly_data to detect deep changes
  const hourlyDataJson = JSON.stringify(hourlyData || {});

  // Reset save status when screenshot changes
  useEffect(() => {
    setLastSaved(null);
    setTimeSinceLastSave("");
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

  // Auto-save effect - immediate save for bar values and title changes
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

    // Save immediately
    const doSave = async () => {
      try {
        setIsSaving(true);
        await onSave(notes);
        setLastSaved(new Date());
      } catch (error) {
        console.error("[AutoSave] Failed:", error);
      } finally {
        setIsSaving(false);
      }
    };

    doSave();
  }, [hourlyDataJson, screenshotId, extractedTitle, notes, onSave, gridCoordsValid, hourlyData]);

  return {
    isSaving,
    lastSaved,
    timeSinceLastSave,
  };
}
