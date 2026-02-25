import { useEffect, useRef, useState } from "react";
import type { UploadFileItem } from "@/store/preprocessingStore";

interface UploadTagTableProps {
  files: UploadFileItem[];
  groupId: string;
  imageType: "battery" | "screen_time";
  onFilesChange: (files: UploadFileItem[]) => void;
  onGroupIdChange: (groupId: string) => void;
  onImageTypeChange: (type: "battery" | "screen_time") => void;
}

export const UploadTagTable = ({
  files,
  groupId,
  imageType,
  onFilesChange,
  onGroupIdChange,
  onImageTypeChange,
}: UploadTagTableProps) => {
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const thumbsGenerated = useRef(false);

  // Generate thumbnails on mount
  useEffect(() => {
    if (thumbsGenerated.current || files.length === 0) return;
    thumbsGenerated.current = true;

    const newThumbs: Record<number, string> = {};
    // Only generate thumbnails for first 50 to avoid perf issues
    const limit = Math.min(files.length, 50);
    for (let i = 0; i < limit; i++) {
      newThumbs[i] = URL.createObjectURL(files[i]!.file);
    }
    setThumbnails(newThumbs);

    return () => {
      Object.values(newThumbs).forEach(URL.revokeObjectURL);
    };
  }, [files]);

  const updateItem = (index: number, field: keyof UploadFileItem, value: string) => {
    const updated = [...files];
    updated[index] = { ...updated[index]!, [field]: value };
    onFilesChange(updated);
  };

  const removeItem = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {/* Group-level fields */}
      <div className="flex flex-wrap items-center gap-4 p-3 bg-gray-50 rounded-lg border">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Group ID:</label>
          <input
            type="text"
            value={groupId}
            onChange={(e) => onGroupIdChange(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 w-48"
            placeholder="e.g. study_2024"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Type:</label>
          <select
            value={imageType}
            onChange={(e) => onImageTypeChange(e.target.value as "battery" | "screen_time")}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5"
          >
            <option value="screen_time">Screen Time</option>
            <option value="battery">Battery</option>
          </select>
        </div>
        <span className="text-sm text-gray-500 ml-auto">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* File table */}
      <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white border-b">
            <tr className="text-left text-gray-500">
              <th className="px-3 py-2 w-12">Thumb</th>
              <th className="px-3 py-2">Filename</th>
              <th className="px-3 py-2 w-40">Participant ID</th>
              <th className="px-3 py-2 w-36">Date</th>
              <th className="px-3 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {files.map((item, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  {thumbnails[i] ? (
                    <img
                      src={thumbnails[i]}
                      alt=""
                      className="w-8 h-11 object-cover rounded"
                    />
                  ) : (
                    <div className="w-8 h-11 bg-gray-200 rounded" />
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs text-gray-600 max-w-xs truncate" title={item.original_filepath}>
                  {item.filename}
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="text"
                    value={item.participant_id}
                    onChange={(e) => updateItem(i, "participant_id", e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="date"
                    value={item.screenshot_date}
                    onChange={(e) => updateItem(i, "screenshot_date", e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => removeItem(i)}
                    className="text-gray-400 hover:text-red-500 text-xs"
                    title="Remove"
                  >
                    x
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
