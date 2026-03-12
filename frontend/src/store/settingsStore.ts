import { create } from "zustand";

export interface ProcessingSettings {
  /** Auto-skip daily total screenshots during preprocessing */
  skipDailyTotals: boolean;
  /** Default grid detection method */
  gridDetectionMethod: "line_based" | "ocr_anchored";
  /** Boundary optimizer max pixel shift (0 = disabled) */
  maxShift: number;
  /** Auto-run OCR processing when screenshots are uploaded */
  autoProcessOnUpload: boolean;
}

const STORAGE_KEY = "processing-settings";

const DEFAULTS: ProcessingSettings = {
  skipDailyTotals: false,
  gridDetectionMethod: "line_based",
  maxShift: 5,
  autoProcessOnUpload: false,
};

function loadFromStorage(): ProcessingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function saveToStorage(settings: ProcessingSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface SettingsState extends ProcessingSettings {
  set: <K extends keyof ProcessingSettings>(key: K, value: ProcessingSettings[K]) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...loadFromStorage(),
  set: (key, value) =>
    set((state) => {
      const updated = { ...state, [key]: value };
      saveToStorage({
        skipDailyTotals: updated.skipDailyTotals,
        gridDetectionMethod: updated.gridDetectionMethod,
        maxShift: updated.maxShift,
        autoProcessOnUpload: updated.autoProcessOnUpload,
      });
      return { [key]: value };
    }),
  reset: () => {
    saveToStorage(DEFAULTS);
    set(DEFAULTS);
  },
}));
