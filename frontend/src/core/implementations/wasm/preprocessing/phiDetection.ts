/**
 * Client-side PHI detection using Tesseract.js OCR + Transformers.js NER + regex patterns.
 *
 * Replicates the server's Presidio + regex pipeline:
 * 1. OCR with Tesseract.js → words with bounding boxes
 * 2. NER with BERT (via Web Worker) → PERSON, ORG, LOC, MISC entities
 * 3. Regex patterns → email, phone, SSN, MRN, etc.
 * 4. Allow-list filtering → remove known false positives (app names, UI labels)
 * 5. Map matches back to image coordinates via OCR word bboxes
 */

import type { PHIRegion } from "@/core/interfaces/IPreprocessingService";
export type { PHIRegion };

export interface PHIDetectionResult {
  regions: PHIRegion[];
  ocrText: string;
  ocrConfidence: number;
}

// Word with bounding box from Tesseract.js
interface OCRWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
  charStart: number; // offset into full text
  charEnd: number;
}

// NER entity from worker
interface NEREntity {
  entity_group: string;
  word: string;
  start: number;
  end: number;
  score: number;
}

// ---------------------------------------------------------------------------
// Regex patterns (ported from Python phi-detector-remover/core/detectors/regex.py)
// ---------------------------------------------------------------------------

const REGEX_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { label: "phone", pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { label: "ssn", pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g },
  { label: "mrn", pattern: /(?:MRN|Medical Record|Record #)[:\s]*(\d{6,10})/gi },
  { label: "study_id", pattern: /(?:GNSM|STUDY)[_-]?\d{4}(?:[_-]\d+)?/gi },
  { label: "zip", pattern: /\b\d{5}(?:-\d{4})?\b/g },
  { label: "url", pattern: /https?:\/\/[^\s]+/g },
  { label: "ip_address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { label: "credit_card", pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
  // Apple device serial (12 alphanumeric chars)
  { label: "device_serial", pattern: /\b[A-Z0-9]{12}\b/g },
  // IMEI (15 digits)
  { label: "imei", pattern: /\b\d{15}\b/g },
  // UUID
  { label: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
];

// ---------------------------------------------------------------------------
// Allow-list — matching server Presidio config
// Terms that should never be flagged as PHI in iOS Screen Time screenshots
// ---------------------------------------------------------------------------

const ALLOW_LIST = new Set([
  // Wi-Fi variations
  "Wi-Fi", "WiFi", "wi",
  // App names commonly flagged as PERSON/ORG
  "Disney", "Disney+", "Lingokids", "Photo Booth",
  "Screen Time", "App Store", "Control Center", "Bluetooth",
  "YT Kids", "YT", "YouTube", "YouTube Kids",
  "TikTok", "Instagram", "Safari", "Netflix",
  "Roblox", "Minecraft", "Fortnite",
  "PBS Kids", "Nick Jr",
  // UI labels
  "Daily Average", "Pickups", "Notifications",
  "Most Used", "Show More", "Show Less",
  "Settings", "General", "Privacy",
  // Time strings (common OCR noise)
  "12 AM", "12AM", "AM", "PM",
]);

// Case-insensitive version for comparison
const ALLOW_LIST_LOWER = new Set([...ALLOW_LIST].map((s) => s.toLowerCase()));

// Entity types to exclude (matching server Presidio config — too many false positives)
const EXCLUDED_ENTITY_TYPES = new Set(["DATE_TIME", "LOCATION", "LOC"]);

// Min bounding box area to consider a valid detection
const MIN_BBOX_AREA = 100;

// ---------------------------------------------------------------------------
// NER Worker management
// ---------------------------------------------------------------------------

let nerWorker: Worker | null = null;
let nerRequestId = 0;
const pendingNER = new Map<number, {
  resolve: (entities: NEREntity[]) => void;
  reject: (err: Error) => void;
}>();

function getNERWorker(): Worker {
  if (!nerWorker) {
    nerWorker = new Worker(
      new URL("./nerWorker.ts", import.meta.url),
      { type: "module" },
    );
    nerWorker.onmessage = (e: MessageEvent) => {
      const { id, entities, error } = e.data;
      if (e.data.type === "ready" || e.data.type === "error") return;
      const pending = pendingNER.get(id);
      if (pending) {
        pendingNER.delete(id);
        if (error) {
          pending.resolve([]); // Graceful fallback — regex still runs
        } else {
          pending.resolve(entities);
        }
      }
    };
    // Pre-initialize the pipeline
    nerWorker.postMessage({ type: "init" });
  }
  return nerWorker;
}

async function runNER(text: string): Promise<NEREntity[]> {
  if (!text.trim()) return [];

  const worker = getNERWorker();
  const id = ++nerRequestId;

  return new Promise((resolve) => {
    pendingNER.set(id, { resolve, reject: () => resolve([]) });
    worker.postMessage({ text, id });

    // Timeout after 30s (model download + inference)
    setTimeout(() => {
      if (pendingNER.has(id)) {
        pendingNER.delete(id);
        resolve([]); // Graceful fallback
      }
    }, 30000);
  });
}

// ---------------------------------------------------------------------------
// Tesseract worker management — singleton, reused across screenshots
// ---------------------------------------------------------------------------

let tesseractWorker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;

async function getTesseractWorker() {
  if (!tesseractWorker) {
    const Tesseract = await import("tesseract.js");
    tesseractWorker = await Tesseract.createWorker("eng");
  }
  return tesseractWorker;
}

export function terminateTesseractWorker(): void {
  if (tesseractWorker) {
    tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

// ---------------------------------------------------------------------------
// OCR helper — extract words with bounding boxes using Tesseract.js
// ---------------------------------------------------------------------------

async function ocrWithBboxes(imageBlob: Blob): Promise<{
  words: OCRWord[];
  fullText: string;
  confidence: number;
}> {
  const imageBitmap = await createImageBitmap(imageBlob);
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  const worker = await getTesseractWorker();
  // Tesseract.js v7 requires a canvas, not raw ImageData
  const result = await worker.recognize(canvas as unknown as HTMLCanvasElement);

  const words: OCRWord[] = [];
  let fullText = "";
  let totalConfidence = 0;
  let wordCount = 0;

  // Tesseract.js v7: blocks → paragraphs → lines → words
  const page = result.data;
  for (const block of (page as any).blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) {
          const charStart = fullText.length;
          fullText += word.text;
          const charEnd = fullText.length;

          words.push({
            text: word.text,
            bbox: word.bbox,
            confidence: word.confidence,
            charStart,
            charEnd,
          });

          totalConfidence += word.confidence;
          wordCount++;

          fullText += " ";
        }
        // Replace trailing space with newline for line breaks
        if (fullText.endsWith(" ")) {
          fullText = fullText.slice(0, -1) + "\n";
        }
      }
    }
  }

  return {
    words,
    fullText: fullText.trim(),
    confidence: wordCount > 0 ? totalConfidence / wordCount : 0,
  };
}

// ---------------------------------------------------------------------------
// Map text offsets back to image bounding boxes
// ---------------------------------------------------------------------------

function offsetToRegion(
  start: number,
  end: number,
  words: OCRWord[],
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;

  for (const word of words) {
    // Check if word overlaps with the match range
    if (word.charEnd > start && word.charStart < end) {
      found = true;
      minX = Math.min(minX, word.bbox.x0);
      minY = Math.min(minY, word.bbox.y0);
      maxX = Math.max(maxX, word.bbox.x1);
      maxY = Math.max(maxY, word.bbox.y1);
    }
  }

  if (!found) return null;

  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

// ---------------------------------------------------------------------------
// Check if a detected text is in the allow list
// ---------------------------------------------------------------------------

function isAllowListed(text: string): boolean {
  const trimmed = text.trim();
  if (ALLOW_LIST.has(trimmed)) return true;
  const trimmedLower = trimmed.toLowerCase();
  if (ALLOW_LIST_LOWER.has(trimmedLower)) return true;

  // Check if the text is a substring of an allow-listed term
  if (trimmed.length >= 3) {
    for (const allowedLower of ALLOW_LIST_LOWER) {
      if (allowedLower.includes(trimmedLower)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

export async function detectPHI(imageBlob: Blob): Promise<PHIDetectionResult> {
  // Step 1: OCR with bounding boxes
  const { words, fullText, confidence } = await ocrWithBboxes(imageBlob);

  if (!fullText.trim()) {
    return { regions: [], ocrText: "", ocrConfidence: 0 };
  }

  // Step 2 & 3: Run NER and regex in parallel
  const [nerEntities, regexMatches] = await Promise.all([
    runNER(fullText),
    Promise.resolve(findRegexMatches(fullText)),
  ]);

  const regions: PHIRegion[] = [];

  // Step 4: Process NER results
  for (const entity of nerEntities) {
    // Skip excluded entity types
    if (EXCLUDED_ENTITY_TYPES.has(entity.entity_group)) continue;

    // Skip allow-listed terms
    if (isAllowListed(entity.word)) continue;

    // Map to image coordinates
    const bbox = offsetToRegion(entity.start, entity.end, words);
    if (!bbox) continue;

    // Skip tiny detections
    if (bbox.w * bbox.h < MIN_BBOX_AREA) continue;

    regions.push({
      ...bbox,
      label: entity.entity_group,
      source: "ner",
      confidence: entity.score,
      text: entity.word,
    });
  }

  // Step 5: Process regex matches
  for (const match of regexMatches) {
    // Skip allow-listed terms
    if (isAllowListed(match.text)) continue;

    // Map to image coordinates
    const bbox = offsetToRegion(match.start, match.end, words);
    if (!bbox) continue;

    // Skip tiny detections
    if (bbox.w * bbox.h < MIN_BBOX_AREA) continue;

    // Avoid duplicates: check if NER already detected this region
    const isDuplicate = regions.some(
      (r) =>
        Math.abs(r.x - bbox.x) < 5 &&
        Math.abs(r.y - bbox.y) < 5 &&
        Math.abs(r.w - bbox.w) < 10 &&
        Math.abs(r.h - bbox.h) < 10,
    );
    if (isDuplicate) continue;

    regions.push({
      ...bbox,
      label: match.label,
      source: "regex",
      confidence: 0.85,
      text: match.text,
    });
  }

  return {
    regions,
    ocrText: fullText,
    ocrConfidence: confidence,
  };
}

// ---------------------------------------------------------------------------
// Regex matching helper
// ---------------------------------------------------------------------------

interface RegexMatch {
  label: string;
  text: string;
  start: number;
  end: number;
}

function findRegexMatches(text: string): RegexMatch[] {
  const matches: RegexMatch[] = [];

  for (const { label, pattern } of REGEX_PATTERNS) {
    // Reset regex state (lastIndex)
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      matches.push({
        label,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return matches;
}

/**
 * Terminate the NER worker to free resources.
 * Call when preprocessing is complete or component unmounts.
 */
export function terminateNERWorker(): void {
  if (nerWorker) {
    nerWorker.terminate();
    nerWorker = null;
    pendingNER.clear();
  }
}
