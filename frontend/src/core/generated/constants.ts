/**
 * AUTO-GENERATED from shared/*.json — do not edit manually.
 * Hash: 3d06d81b77a42a95
 * Regenerate: python scripts/generate-shared-constants.py
 */

export const RESOLUTION_LOOKUP_TABLE: Record<string, { x: number; y: number; width: number; height: number }> = {
  "640x1136": { x: 30, y: 270, width: 510, height: 180 },
  "750x1334": { x: 60, y: 670, width: 560, height: 180 },
  "750x1624": { x: 60, y: 450, width: 560, height: 180 },
  "828x1792": { x: 70, y: 450, width: 620, height: 180 },
  "848x2266": { x: 70, y: 390, width: 640, height: 180 },
  "858x2160": { x: 70, y: 390, width: 640, height: 180 },
  "896x2048": { x: 70, y: 500, width: 670, height: 180 },
  "906x2160": { x: 70, y: 390, width: 690, height: 180 },
  "960x2079": { x: 80, y: 620, width: 720, height: 270 },
  "980x2160": { x: 80, y: 390, width: 730, height: 180 },
  "990x2160": { x: 80, y: 390, width: 740, height: 180 },
  "1000x2360": { x: 80, y: 420, width: 790, height: 180 },
  "1028x2224": { x: 80, y: 400, width: 820, height: 180 },
  "1028x2388": { x: 80, y: 400, width: 820, height: 180 },
  "1170x2532": { x: 90, y: 640, width: 880, height: 270 },
  "1258x2732": { x: 80, y: 450, width: 1020, height: 180 },
};

export const DAILY_PAGE_MARKERS: readonly string[] = ["WEEK", "DAY", "MOST", "USED", "CATEGORIES", "TODAY", "SHOW", "ENTERTAINMENT", "EDUCATION", "INFORMATION", "READING"] as const;
export const APP_PAGE_MARKERS: readonly string[] = ["INFO", "DEVELOPER", "RATING", "LIMIT", "AGE", "DAILY", "AVERAGE"] as const;

export const NUM_SLICES = 24;
export const MAX_Y = 60;
export const LOWER_GRID_BUFFER = 2;
export const SCALE_AMOUNT = 4;
export const DARK_MODE_THRESHOLD = 100;
export const DARKEN_NON_WHITE_THRESHOLD = 720;

export const H_GRAY_MIN = 195;
export const H_GRAY_MAX = 210;
export const H_MIN_WIDTH_PCT = 0.35;
export const V_GRAY_MIN = 190;
export const V_GRAY_MAX = 215;
export const V_MIN_HEIGHT_PCT = 0.4;
export const EDGE_GRAY_MIN = 190;
export const EDGE_GRAY_MAX = 220;

export const BLUE_HUE_MIN = 100;
export const BLUE_HUE_MAX = 130;
export const CYAN_HUE_MIN = 80;
export const CYAN_HUE_MAX = 100;
export const COLOR_MIN_SATURATION = 50;
export const COLOR_MIN_VALUE = 50;
export const MIN_BLUE_RATIO = 0.5;

export const SHARED_CONSTANTS_HASH = "3d06d81b77a42a95";
