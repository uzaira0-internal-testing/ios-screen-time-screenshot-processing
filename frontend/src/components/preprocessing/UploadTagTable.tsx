import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  const [regexInput, setRegexInput] = useState("");
  const [regexError, setRegexError] = useState<string | null>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const ROW_HEIGHT = 52; // px — must match the rendered row height

  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Generate thumbnails on mount (first 50 only)
  useEffect(() => {
    if (thumbsGenerated.current || files.length === 0) return;
    thumbsGenerated.current = true;

    const newThumbs: Record<number, string> = {};
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

  const applyRegex = () => {
    const trimmed = regexInput.trim();
    if (!trimmed) {
      setRegexError(null);
      return;
    }

    // If the user didn't include a capture group, wrap the whole pattern in one
    const pattern = trimmed.includes("(") ? trimmed : `(${trimmed})`;

    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch (e) {
      setRegexError(`Invalid regex: ${(e as Error).message}`);
      return;
    }

    setRegexError(null);
    const updated = files.map((item) => {
      const match = item.original_filepath.match(re);
      if (match && match[1]) {
        return { ...item, participant_id: match[1] };
      }
      return item;
    });
    onFilesChange(updated);
  };

  return (
    <div className="space-y-4">
      {/* Group-level fields */}
      <div className="flex flex-wrap items-center gap-4 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg border dark:border-slate-700">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Group ID:</label>
          <input
            type="text"
            value={groupId}
            onChange={(e) => onGroupIdChange(e.target.value)}
            className="text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-md px-3 py-1.5 w-48"
            placeholder="e.g. study_2024"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Type:</label>
          <select
            value={imageType}
            onChange={(e) => onImageTypeChange(e.target.value as "battery" | "screen_time")}
            className="text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-md px-2 py-1.5"
          >
            <option value="screen_time">Screen Time</option>
            <option value="battery">Battery</option>
          </select>
        </div>
        <span className="text-sm text-slate-500 dark:text-slate-400 ml-auto">
          {files.length} file{files.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Participant ID Regex */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg border dark:border-slate-700">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Participant ID Regex:</label>
          <input
            type="text"
            value={regexInput}
            onChange={(e) => { setRegexInput(e.target.value); setRegexError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") applyRegex(); }}
            className={`text-sm border rounded-md px-3 py-1.5 flex-1 min-w-[200px] font-mono ${
              regexError ? "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/20" : "border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            }`}
            placeholder="e.g. (P\d-\d{4})"
          />
          <button
            type="button"
            onClick={applyRegex}
            className="px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-md hover:bg-primary-100"
          >
            Apply
          </button>
        </div>
        {regexError && (
          <p className="w-full text-xs text-red-600">{regexError}</p>
        )}
        {!regexError && regexInput.trim() && (
          <p className="w-full text-xs text-slate-400">
            First capture group from each file's path becomes participant_id
          </p>
        )}
      </div>

      {/* File list — virtualized so large folders don't freeze the browser.
          Uses CSS grid divs (not <table>) because position:absolute on <tr> breaks table layout. */}
      <div className="border dark:border-slate-700 rounded-lg overflow-hidden text-sm">
        {/* Sticky header row */}
        <div
          className="grid text-left text-xs font-medium text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border-b dark:border-slate-700 px-3 py-2"
          style={{ gridTemplateColumns: "48px 1fr 160px 144px 40px" }}
        >
          <span>Thumb</span>
          <span>Filename</span>
          <span>Participant ID</span>
          <span>Date</span>
          <span />
        </div>
        {/* Virtualized scroll body */}
        <div ref={scrollParentRef} className="overflow-y-auto" style={{ maxHeight: 384 }}>
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const i = virtualRow.index;
              const item = files[i]!;
              return (
                <div
                  key={i}
                  className="grid items-center border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 px-3"
                  style={{
                    gridTemplateColumns: "48px 1fr 160px 144px 40px",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${ROW_HEIGHT}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="py-1.5">
                    {thumbnails[i] ? (
                      <img src={thumbnails[i]} alt="" className="w-8 h-11 object-cover rounded" />
                    ) : (
                      <div className="w-8 h-11 bg-slate-200 dark:bg-slate-600 rounded" />
                    )}
                  </div>
                  <div className="py-1.5 pr-2 text-xs text-slate-600 dark:text-slate-400 truncate min-w-0" title={item.original_filepath}>
                    {item.filename}
                  </div>
                  <div className="py-1.5 pr-2">
                    <input
                      type="text"
                      value={item.participant_id}
                      onChange={(e) => updateItem(i, "participant_id", e.target.value)}
                      className="w-full text-xs border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded px-2 py-1"
                    />
                  </div>
                  <div className="py-1.5 pr-2">
                    <input
                      type="date"
                      value={item.screenshot_date}
                      onChange={(e) => updateItem(i, "screenshot_date", e.target.value)}
                      className="w-full text-xs border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded px-2 py-1"
                    />
                  </div>
                  <div className="py-1.5">
                    <button
                      onClick={() => removeItem(i)}
                      className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 text-sm leading-none"
                      title="Remove file"
                      aria-label={`Remove ${item.filename}`}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
