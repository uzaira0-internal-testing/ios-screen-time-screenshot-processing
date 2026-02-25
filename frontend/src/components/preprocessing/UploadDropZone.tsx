import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import type { UploadFileItem } from "@/store/preprocessingStore";

interface UploadDropZoneProps {
  onFilesSelected: (files: UploadFileItem[]) => void;
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
      screenshot_date: parts[parts.length - 2]!,
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
