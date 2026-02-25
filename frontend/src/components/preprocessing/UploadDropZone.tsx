import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import type { UploadFileItem } from "@/store/preprocessingStore";

interface UploadDropZoneProps {
  onFilesSelected: (files: UploadFileItem[]) => void;
}

/**
 * Try to parse a date string from a folder name into yyyy-MM-dd format.
 * Handles many variations:
 *   "2024-01-15"           → "2024-01-15"
 *   "2024_01_15"           → "2024-01-15"
 *   "01-15-2024"           → "2024-01-15"
 *   "01.15.2024"           → "2024-01-15"
 *   "10.25.2024"           → "2024-10-25"
 *   "Day 10 10.25.2024"    → "2024-10-25"
 *   "Day 10 10-25-2024"    → "2024-10-25"
 *   "Day_3_01.02.2025"     → "2025-01-02"
 *   "2024-Jan-15"          → "2024-01-15"
 *   "Jan 15, 2024"         → "2024-01-15"
 *   "15 Jan 2024"          → "2024-01-15"
 *   "January 15, 2024"     → "2024-01-15"
 * Returns "" if no date can be extracted.
 */
function parseDateFromFolder(raw: string): string {
  if (!raw) return "";

  const MONTHS: Record<string, string> = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06",
    jul: "07", july: "07", aug: "08", august: "08", sep: "09", september: "09",
    oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12",
  };

  const pad = (n: number) => String(n).padStart(2, "0");
  const s = raw.trim();

  // Already yyyy-MM-dd
  let m = s.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2]!)}-${pad(+m[3]!)}`;

  // yyyy-Mon-dd or yyyy-Month-dd
  m = s.match(/(\d{4})[-_ ]([A-Za-z]+)[-_ ](\d{1,2})/);
  if (m && MONTHS[m[2]!.toLowerCase()]) {
    return `${m[1]}-${MONTHS[m[2]!.toLowerCase()]}-${pad(+m[3]!)}`;
  }

  // MM.DD.YYYY or MM-DD-YYYY or MM/DD/YYYY (possibly embedded in a longer string like "Day 10 10.25.2024")
  m = s.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) {
    const a = +m[1]!, b = +m[2]!, year = +m[3]!;
    // Disambiguate: if a > 12, it's DD.MM.YYYY; otherwise assume MM.DD.YYYY (US convention)
    if (a > 12 && b <= 12) return `${year}-${pad(b)}-${pad(a)}`;
    if (a <= 12) return `${year}-${pad(a)}-${pad(b)}`;
    return `${year}-${pad(a)}-${pad(b)}`;
  }

  // Mon DD, YYYY or Month DD, YYYY
  m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1]!.toLowerCase()]) {
    return `${m[3]}-${MONTHS[m[1]!.toLowerCase()]}-${pad(+m[2]!)}`;
  }

  // DD Mon YYYY or DD Month YYYY
  m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && MONTHS[m[2]!.toLowerCase()]) {
    return `${m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${pad(+m[1]!)}`;
  }

  return "";
}

/**
 * Parse webkitRelativePath to extract participant_id, date, and filename.
 * Patterns:
 *   participant_id/date/filename.png → all three
 *   participant_id/filename.png → participant + filename
 *   filename.png → "unknown" participant
 */
function parseRelativePath(file: File): { participant_id: string; screenshot_date: string; filename: string; original_filepath: string } {
  const relativePath = (file as any).webkitRelativePath || file.name;
  const parts = relativePath.split("/").filter(Boolean);

  if (parts.length >= 3) {
    return {
      participant_id: parts[parts.length - 3]!,
      screenshot_date: parseDateFromFolder(parts[parts.length - 2]!),
      filename: parts[parts.length - 1]!,
      original_filepath: relativePath,
    };
  } else if (parts.length === 2) {
    return {
      participant_id: parts[0]!,
      screenshot_date: "",
      filename: parts[1]!,
      original_filepath: relativePath,
    };
  } else {
    return {
      participant_id: "unknown",
      screenshot_date: "",
      filename: file.name,
      original_filepath: file.name,
    };
  }
}

function isImageFile(file: File): boolean {
  return file.type === "image/png" || file.type === "image/jpeg" || file.name.endsWith(".png") || file.name.endsWith(".jpg") || file.name.endsWith(".jpeg");
}

export const UploadDropZone = ({ onFilesSelected }: UploadDropZoneProps) => {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const imageFiles = acceptedFiles.filter(isImageFile);
      const items: UploadFileItem[] = imageFiles.map((file) => {
        const parsed = parseRelativePath(file);
        return {
          file,
          participant_id: parsed.participant_id,
          filename: parsed.filename,
          original_filepath: parsed.original_filepath,
          screenshot_date: parsed.screenshot_date,
        };
      });
      onFilesSelected(items);
    },
    [onFilesSelected],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] },
    multiple: true,
    noClick: true,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
        isDragActive ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
      }`}
    >
      <input {...getInputProps()} />
      {/* @ts-expect-error webkitdirectory is a non-standard attribute */}
      <input {...getInputProps()} webkitdirectory="" directory="" style={{ display: "none" }} id="folder-input" />
      <div className="space-y-3">
        <div className="text-4xl text-gray-400">
          {isDragActive ? "+" : "^"}
        </div>
        <p className="text-gray-600 font-medium">
          {isDragActive ? "Drop files here..." : "Drop screenshot files or folders here"}
        </p>
        <p className="text-sm text-gray-400">
          PNG/JPEG images. Folder structure: participant_id/date/filename.png
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            onClick={open}
          >
            Select Files
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById("folder-input")?.click();
            }}
          >
            Select Folder
          </button>
        </div>
      </div>
    </div>
  );
};
