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
  /** OCR engine for PHI detection: tesseract (default) or rust (faster) */
  phiOcrEngine: "tesseract" | "rust";
  /** NER detector for PHI detection: presidio (fast) or gliner (accurate) */
  phiNerDetector: "presidio" | "gliner";
  /** PHI pipeline preset */
  phiPipelinePreset: "fast" | "balanced" | "hipaa_compliant" | "thorough" | "screen_time";
  /** PHI redaction method */
  phiRedactionMethod: "redbox" | "blackbox" | "pixelate";
}

const STORAGE_KEY = "processing-settings";

const DEFAULTS: ProcessingSettings = {
  skipDailyTotals: false,
  gridDetectionMethod: "line_based",
  maxShift: 5,
  autoProcessOnUpload: false,
  phiOcrEngine: "tesseract",
  phiNerDetector: "presidio",
  phiPipelinePreset: "screen_time",
  phiRedactionMethod: "redbox",
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
        phiOcrEngine: updated.phiOcrEngine,
        phiNerDetector: updated.phiNerDetector,
        phiPipelinePreset: updated.phiPipelinePreset,
        phiRedactionMethod: updated.phiRedactionMethod,
      });
      return { [key]: value };
    }),
  reset: () => {
    saveToStorage(DEFAULTS);
    set(DEFAULTS);
  },
}));
