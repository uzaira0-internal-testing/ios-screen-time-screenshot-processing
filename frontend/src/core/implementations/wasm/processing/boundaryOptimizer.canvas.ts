/**
 * Boundary Optimizer - Canvas 2D API Implementation
 *
 * Port of Python boundary_optimizer.py. After initial grid detection,
 * tries small shifts in x, y, and width to find the grid position where
 * extracted bar totals best match the OCR total.
 */

import type { GridCoordinates, HourlyData } from "@/types";
import type { CanvasMat } from "./canvasImageUtils";
import { extractHourlyData, preprocessForExtraction, extractHourlyDataFromPreprocessed } from "./barExtraction.canvas";

// ---------------------------------------------------------------------------
// Parse OCR total string to minutes
// ---------------------------------------------------------------------------

const DIGIT_MAP: Record<string, string> = {
  O: "0", o: "0", Q: "0",
  l: "1", I: "1", "|": "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6",
  B: "8",
  g: "9",
};

function normalizeOcrDigits(text: string): string {
  return text.replace(/[OoQlI|ZzSsGB9g]/g, (ch) => DIGIT_MAP[ch] ?? ch);
}

export function parseOcrTotal(ocrTotal: string): number | null {
  if (!ocrTotal || ocrTotal === "N/A") return null;

  const text = normalizeOcrDigits(ocrTotal).trim().toLowerCase();
  let totalMinutes = 0;

  const hourMatch = text.match(/(\d{1,2})\s*h/);
  if (hourMatch) totalMinutes += parseInt(hourMatch[1]!, 10) * 60;

  const minMatch = text.match(/(\d{1,2})\s*m(?!s)/);
  if (minMatch) totalMinutes += parseInt(minMatch[1]!, 10);

  if (totalMinutes === 0) {
    const secMatch = text.match(/(\d{1,2})\s*s/);
    if (secMatch) return 0;
  }

  return totalMinutes > 0 ? totalMinutes : null;
}

// ---------------------------------------------------------------------------
// 7→1 OCR correction (common OCR confusion)
// ---------------------------------------------------------------------------

function generate71Alternatives(ocrTotal: string): Array<{ text: string; desc: string }> {
  const alts: Array<{ text: string; desc: string }> = [{ text: ocrTotal, desc: "original" }];
  const positions = [...ocrTotal].reduce<number[]>((acc, ch, i) => {
    if (ch === "7") acc.push(i);
    return acc;
  }, []);

  if (positions.length === 0) return alts;

  for (const pos of positions) {
    alts.push({
      text: ocrTotal.slice(0, pos) + "1" + ocrTotal.slice(pos + 1),
      desc: `7->1 at ${pos}`,
    });
  }

  if (positions.length > 1) {
    alts.push({ text: ocrTotal.replace(/7/g, "1"), desc: "all 7->1" });
  }

  return alts;
}

function correctOcrTotalWithBarHint(
  ocrTotal: string,
  barTotalMinutes: number,
): { correctedTotal: string; correctedMinutes: number } {
  const alts = generate71Alternatives(ocrTotal);
  let bestTotal = ocrTotal;
  let bestMinutes = parseOcrTotal(ocrTotal) ?? 0;
  let bestDiff = Math.abs(bestMinutes - barTotalMinutes);

  for (const { text } of alts.slice(1)) {
    const mins = parseOcrTotal(text);
    if (mins === null) continue;
    const diff = Math.abs(mins - barTotalMinutes);
    if (diff < bestDiff) {
      bestTotal = text;
      bestMinutes = mins;
      bestDiff = diff;
    }
  }

  return { correctedTotal: bestTotal, correctedMinutes: bestMinutes };
}

// ---------------------------------------------------------------------------
// Optimization result
// ---------------------------------------------------------------------------

export interface OptimizationResult {
  bounds: GridCoordinates;
  barTotalMinutes: number;
  ocrTotalMinutes: number;
  shiftX: number;
  shiftY: number;
  shiftWidth: number;
  iterations: number;
  converged: boolean;
  hourlyData: HourlyData;
}

// ---------------------------------------------------------------------------
// Main optimizer
// ---------------------------------------------------------------------------

/**
 * Optimize grid boundaries to match OCR total.
 *
 * Brute-forces small shifts in x, y, and width to find the grid position
 * where extracted bar totals best match the OCR-extracted total.
 *
 * @param image - Source image (CanvasMat)
 * @param initialBounds - Initial grid coordinates from detection
 * @param ocrTotal - OCR-extracted total string (e.g., "1h 31m")
 * @param maxShift - Maximum pixels to shift in each direction (0 = disabled)
 * @param isBattery - Whether this is a battery screenshot
 * @returns Optimized result with best grid bounds and hourly data
 */
export function optimizeBoundaries(
  image: CanvasMat,
  initialBounds: GridCoordinates,
  ocrTotal: string,
  maxShift: number = 10,
  isBattery: boolean = false,
): OptimizationResult {
  const targetMinutes = parseOcrTotal(ocrTotal);

  // If we can't parse the OCR total, just extract with original bounds
  if (targetMinutes === null) {
    const hourlyData = extractHourlyData(image, initialBounds, isBattery);
    const barTotal = sumHourlyData(hourlyData);
    return {
      bounds: initialBounds,
      barTotalMinutes: barTotal,
      ocrTotalMinutes: 0,
      shiftX: 0,
      shiftY: 0,
      shiftWidth: 0,
      iterations: 0,
      converged: false,
      hourlyData,
    };
  }

  const imgW = image.width;
  const imgH = image.height;

  let bestBounds = initialBounds;
  let bestDiff = Infinity;
  let bestBarTotal = 0;
  let bestShiftX = 0;
  let bestShiftY = 0;
  let bestShiftWidth = 0;
  let bestHourlyData: HourlyData = {};
  let iterations = 0;

  const origX = initialBounds.upper_left.x;
  const origY = initialBounds.upper_left.y;
  const origW = initialBounds.lower_right.x - initialBounds.upper_left.x;
  const origH = initialBounds.lower_right.y - initialBounds.upper_left.y;

  // Preprocess the image ONCE (clone → color filter → darken → reduce → scale 4×).
  // Then each shift iteration only does cheap ROI extraction + bar height analysis.
  const scaled = preprocessForExtraction(image, initialBounds, isBattery);

  // Try different shifts: Y step=1 (fine), X/width step=2 (coarser)
  for (let shiftX = -maxShift; shiftX <= maxShift; shiftX += 2) {
    for (let shiftY = -maxShift; shiftY <= maxShift; shiftY += 1) {
      for (let shiftWidth = -maxShift; shiftWidth <= maxShift; shiftWidth += 2) {
        iterations++;

        const newX = origX + shiftX;
        const newY = origY + shiftY;
        const newW = origW + shiftWidth;

        // Validate bounds
        if (newX < 0 || newY < 0 || newW <= 0) continue;
        if (newX + newW > imgW) continue;
        if (newY + origH > imgH) continue;

        const testBounds: GridCoordinates = {
          upper_left: { x: newX, y: newY },
          lower_right: { x: newX + newW, y: newY + origH },
        };

        const hourlyData = extractHourlyDataFromPreprocessed(scaled, testBounds);
        const barTotal = sumHourlyData(hourlyData);
        const diff = Math.abs(barTotal - targetMinutes);

        // Tie-breaker: prefer smaller shifts (horizontal penalized 5x)
        const shiftPenalty = 5 * Math.abs(shiftX) + Math.abs(shiftY) + 5 * Math.abs(shiftWidth);
        const bestShiftPenalty = 5 * Math.abs(bestShiftX) + Math.abs(bestShiftY) + 5 * Math.abs(bestShiftWidth);

        const isBetter = diff < bestDiff || (diff === bestDiff && shiftPenalty < bestShiftPenalty);

        if (isBetter) {
          bestDiff = diff;
          bestBounds = testBounds;
          bestBarTotal = barTotal;
          bestShiftX = shiftX;
          bestShiftY = shiftY;
          bestShiftWidth = shiftWidth;
          bestHourlyData = hourlyData;

          // Early exit on exact match at origin
          if (diff === 0 && shiftPenalty === 0) {
            return {
              bounds: bestBounds,
              barTotalMinutes: bestBarTotal,
              ocrTotalMinutes: targetMinutes,
              shiftX: bestShiftX,
              shiftY: bestShiftY,
              shiftWidth: bestShiftWidth,
              iterations,
              converged: true,
              hourlyData: bestHourlyData,
            };
          }
        }
      }
    }
  }

  // Apply 7→1 OCR correction
  const { correctedMinutes } = correctOcrTotalWithBarHint(ocrTotal, bestBarTotal);
  const finalDiff = Math.abs(bestBarTotal - correctedMinutes);

  return {
    bounds: bestBounds,
    barTotalMinutes: bestBarTotal,
    ocrTotalMinutes: correctedMinutes,
    shiftX: bestShiftX,
    shiftY: bestShiftY,
    shiftWidth: bestShiftWidth,
    iterations,
    converged: finalDiff <= 1,
    hourlyData: bestHourlyData,
  };
}

function sumHourlyData(data: HourlyData): number {
  return Object.values(data).reduce((sum, v) => sum + (v ?? 0), 0);
}
