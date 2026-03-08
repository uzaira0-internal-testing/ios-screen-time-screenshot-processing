import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/services/apiClient";
import { config } from "@/config";
import toast from "react-hot-toast";

export interface PHIRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  source: string;
  confidence: number;
  text: string;
}

export interface RecentPHIConfig {
  regions: PHIRegion[];
  label: string;
}

interface PHIRegionEditorProps {
  screenshotId: number;
  isOpen: boolean;
  onClose: () => void;
  onRegionsSaved: () => void;
  onRedactionApplied: () => void;
  inline?: boolean;
  onSaveAndNext?: () => void;
  recentPHIConfigs?: RecentPHIConfig[];
}

type Tool = "draw" | "select" | "delete";

const LABELS = [
  // Presidio entity types
  "PERSON",
  "DATE_TIME",
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "LOCATION",
  "CREDIT_CARD",
  "URL",
  "IP_ADDRESS",
  "US_SSN",
  "US_DRIVER_LICENSE",
  "US_PASSPORT",
  // Custom pattern types
  "DEVICE_SERIAL",
  "MRN",
  "STUDY_ID",
  "AGE",
  "ZIP_CODE",
  // Generic
  "OTHER",
  "UNKNOWN",
];

export const PHIRegionEditor = ({
  screenshotId,
  isOpen,
  onClose,
  onRegionsSaved,
  onRedactionApplied,
  inline = false,
  onSaveAndNext,
  recentPHIConfigs,
}: PHIRegionEditorProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [regions, setRegions] = useState<PHIRegion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [scale, setScale] = useState(1);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRedacting, setIsRedacting] = useState(false);
  const [redactionMethod, setRedactionMethod] = useState("redbox");
  const [imageError, setImageError] = useState(false);

  // Close on Escape key (skip in inline mode — queue view handles keyboard)
  useEffect(() => {
    if (!isOpen || inline) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, inline]);

  // Inline mode keyboard shortcuts
  const handleDeleteAutoRef = useRef<() => void>(() => {});
  const handleSaveAndNextRef = useRef<() => void>(() => {});
  handleDeleteAutoRef.current = () => {
    const autoRegions = regions.filter((r) => r.source !== "manual");
    if (autoRegions.length === 0) return;
    setRegions((prev) => prev.filter((r) => r.source === "manual"));
    setSelectedIndex(null);
    toast.success(`Removed ${autoRegions.length} auto-detected region(s)`);
  };
  // handleSaveAndNextRef is assigned after handleSaveAndNext is defined (below the early return)

  useEffect(() => {
    if (!inline) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Shift+D: delete all auto-detected regions
      if (e.key === "D" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleDeleteAutoRef.current();
      }
      // Ctrl/Cmd+Enter: save & next
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSaveAndNextRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inline]);

  // Load image and regions on open (inline mode is always "open")
  useEffect(() => {
    if (!isOpen && !inline) return;
    setImageError(false);
    setImage(null);
    setRegions([]);
    setSelectedIndex(null);

    // Load the cropped image (not the redacted one)
    const img = new Image();
    img.crossOrigin = "anonymous";
    const imageUrl = `${config.apiBaseUrl}/screenshots/${screenshotId}/stage-image?stage=cropping`;
    img.src = imageUrl;
    img.onload = () => setImage(img);
    img.onerror = () => setImageError(true);

    // Load existing regions
    api.preprocessing.getPHIRegions(screenshotId).then((data: { regions: PHIRegion[] }) => {
      setRegions(data.regions || []);
    }).catch(() => {
      setRegions([]);
    });
  }, [isOpen, inline, screenshotId]);

  // Calculate scale
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const container = canvasRef.current.parentElement;
    if (!container) return;
    const maxW = container.clientWidth - 10;
    const maxH = window.innerHeight - 200;
    const s = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight, 1);
    setScale(s);
  }, [image]);

  // Draw canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !image) return;

    const w = Math.round(image.naturalWidth * scale);
    const h = Math.round(image.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(image, 0, 0, w, h);

    // Draw regions
    regions.forEach((region, i) => {
      const rx = region.x * scale;
      const ry = region.y * scale;
      const rw = region.w * scale;
      const rh = region.h * scale;

      const isAuto = region.source !== "manual";
      const isSelected = i === selectedIndex;

      // Fill
      ctx.fillStyle = isAuto ? "rgba(239, 68, 68, 0.2)" : "rgba(59, 130, 246, 0.2)";
      ctx.fillRect(rx, ry, rw, rh);

      // Border
      ctx.strokeStyle = isSelected ? "#fbbf24" : isAuto ? "#ef4444" : "#3b82f6";
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeRect(rx, ry, rw, rh);

      // Label
      ctx.font = "10px sans-serif";
      ctx.fillStyle = isAuto ? "#ef4444" : "#3b82f6";
      ctx.fillText(`${i + 1}: ${region.label}`, rx + 2, ry - 3);

      // Resize handles for selected region
      if (isSelected) {
        ctx.fillStyle = "#fbbf24";
        const handles = [
          [rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh],
        ];
        for (const [hx, hy] of handles) {
          ctx.fillRect(hx! - 4, hy! - 4, 8, 8);
        }
      }
    });

    // Draw current drawing rect
    if (drawStart && drawCurrent && tool === "draw") {
      const dx = Math.min(drawStart.x, drawCurrent.x) * scale;
      const dy = Math.min(drawStart.y, drawCurrent.y) * scale;
      const dw = Math.abs(drawCurrent.x - drawStart.x) * scale;
      const dh = Math.abs(drawCurrent.y - drawStart.y) * scale;
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(dx, dy, dw, dh);
      ctx.setLineDash([]);
    }
  }, [image, regions, selectedIndex, scale, drawStart, drawCurrent, tool]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const toImageCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / scale),
      y: Math.round((e.clientY - rect.top) / scale),
    };
  };

  const findRegionAt = (x: number, y: number): number | null => {
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i]!;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = toImageCoords(e);

    if (tool === "draw") {
      setDrawStart(pt);
      setDrawCurrent(pt);
    } else if (tool === "select") {
      const idx = findRegionAt(pt.x, pt.y);
      setSelectedIndex(idx);
    } else if (tool === "delete") {
      const idx = findRegionAt(pt.x, pt.y);
      if (idx !== null) {
        setRegions((prev) => prev.filter((_, i) => i !== idx));
        setSelectedIndex(null);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === "draw" && drawStart) {
      setDrawCurrent(toImageCoords(e));
    }
  };

  const handleMouseUp = () => {
    if (tool === "draw" && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);

      if (w >= 5 && h >= 5) {
        setRegions((prev) => {
          const updated = [
            ...prev,
            { x, y, w, h, label: "OTHER", source: "manual", confidence: 1.0, text: "" },
          ];
          setSelectedIndex(updated.length - 1);
          return updated;
        });
      }
    }
    setDrawStart(null);
    setDrawCurrent(null);
  };

  const getCursor = (): string => {
    switch (tool) {
      case "draw": return "crosshair";
      case "delete": return "not-allowed";
      default: return "default";
    }
  };

  const updateRegion = (index: number, updates: Partial<PHIRegion>) => {
    setRegions((prev) => prev.map((r, i) => i === index ? { ...r, ...updates } : r));
  };

  const deleteRegion = (index: number) => {
    setRegions((prev) => prev.filter((_, i) => i !== index));
    if (selectedIndex === index) setSelectedIndex(null);
    else if (selectedIndex !== null && selectedIndex > index) setSelectedIndex(selectedIndex - 1);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.preprocessing.savePHIRegions(screenshotId, { regions, preset: "manual" });
      toast.success(`Saved ${regions.length} PHI region(s)`);
      onRegionsSaved();
    } catch (err) {
      toast.error(`Save failed: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRedact = async () => {
    const confirmed = window.confirm(
      `Apply ${redactionMethod} redaction to ${regions.length} region(s)? This will create a new redacted image and mark the redaction stage as complete.`,
    );
    if (!confirmed) return;

    setIsRedacting(true);
    try {
      await api.preprocessing.applyRedaction(screenshotId, { regions, redaction_method: redactionMethod });
      toast.success("Redaction applied");
      onRedactionApplied();
      onClose();
    } catch (err) {
      toast.error(`Redaction failed: ${err}`);
    } finally {
      setIsRedacting(false);
    }
  };

  if (!isOpen && !inline) return null;

  const autoCount = regions.filter((r) => r.source !== "manual").length;
  const manualCount = regions.length - autoCount;

  const handleSaveAndNext = async () => {
    setIsSaving(true);
    try {
      await api.preprocessing.savePHIRegions(screenshotId, { regions, preset: "manual" });
      toast.success(`Saved ${regions.length} PHI region(s)`);
      onRegionsSaved();
      onSaveAndNext?.();
    } catch (err) {
      toast.error(`Save failed: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Wire up the ref so the keyboard shortcut can call it
  handleSaveAndNextRef.current = onSaveAndNext ? handleSaveAndNext : () => {};

  const editorContent = (
    <div className="flex-1 flex overflow-hidden">
      {/* Canvas area */}
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
        {imageError ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2">
            <span className="text-red-500 text-sm">Failed to load image</span>
            {!inline && (
              <button
                onClick={onClose}
                className="px-3 py-1 text-sm text-slate-600 border border-slate-300 rounded hover:bg-slate-50"
              >
                Close
              </button>
            )}
          </div>
        ) : image ? (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`PHI region editor for screenshot ${screenshotId}. ${regions.length} regions marked. Use the toolbar to select Draw, Select, or Delete tools.`}
            style={{ cursor: getCursor() }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        ) : (
          <div className="flex items-center justify-center h-64 gap-2">
            <span className="inline-block w-5 h-5 border-2 border-slate-300 border-t-primary-500 rounded-full animate-spin" />
            <span className="text-slate-400">Loading image...</span>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-80 border-l dark:border-slate-700 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-1 p-3 border-b dark:border-slate-700">
          {(["select", "draw", "delete"] as Tool[]).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              aria-label={`${t === "select" ? "Select" : t === "draw" ? "Draw" : "Delete"} tool`}
              aria-pressed={tool === t}
              className={`px-3 py-1.5 text-xs rounded font-medium ${
                tool === t
                  ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 border border-primary-300 dark:border-primary-700"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 border border-transparent"
              }`}
            >
              {t === "select" ? "Select" : t === "draw" ? "Draw" : "Delete"}
            </button>
          ))}
        </div>

        {/* Region list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {/* Recent region configs (inline queue mode only) */}
          {inline && recentPHIConfigs && recentPHIConfigs.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Recent Regions</div>
              <div className="flex flex-wrap gap-1.5">
                {recentPHIConfigs.map((cfg, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (regions.length > 0 && !window.confirm(`Replace ${regions.length} existing region(s) with this config?`)) return;
                      setRegions(cfg.regions);
                      setSelectedIndex(null);
                    }}
                    className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-300 hover:text-primary-700 transition-colors"
                    title={`Apply ${cfg.regions.length} region(s): ${cfg.label}`}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            {autoCount} auto-detected, {manualCount} manual
          </div>
          {regions.map((region, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 p-2 rounded text-xs cursor-pointer ${
                i === selectedIndex ? "bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700" : "hover:bg-slate-50 dark:hover:bg-slate-700 border border-transparent"
              }`}
              onClick={() => setSelectedIndex(i)}
            >
              <span className="font-mono text-slate-400 w-4">{i + 1}</span>
              <span className="text-slate-500">
                {region.x},{region.y} {region.w}x{region.h}
              </span>
              <select
                value={region.label}
                onChange={(e) => updateRegion(i, { label: e.target.value })}
                className="text-xs border dark:border-slate-600 rounded px-1 py-0.5 flex-1 dark:bg-slate-700 dark:text-slate-200"
                onClick={(e) => e.stopPropagation()}
              >
                {(!LABELS.includes(region.label) ? [region.label, ...LABELS] : LABELS).map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  region.source === "manual" ? "bg-primary-100 text-primary-600" : "bg-red-100 text-red-600"
                }`}
              >
                {region.source === "manual" ? "M" : "A"}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteRegion(i); }}
                className="text-slate-400 hover:text-red-500 leading-none"
                title="Delete region"
                aria-label={`Delete region ${i + 1}`}
              >
                &times;
              </button>
            </div>
          ))}
          {regions.length === 0 && (
            <div className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">
              No PHI regions. Use Draw tool to add regions.
            </div>
          )}
        </div>

        {/* Redaction method */}
        <div className="p-3 border-t dark:border-slate-700 space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">Method:</label>
            <select
              value={redactionMethod}
              onChange={(e) => setRedactionMethod(e.target.value)}
              className="text-xs border dark:border-slate-600 rounded px-2 py-1 flex-1 dark:bg-slate-700 dark:text-slate-200"
            >
              <option value="redbox">Red Box</option>
              <option value="blackbox">Black Box</option>
              <option value="pixelate">Pixelate</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 px-3 py-2 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded hover:bg-primary-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200"
            >
              {isSaving ? "Saving..." : "Save Regions"}
            </button>
            <button
              onClick={handleRedact}
              disabled={isRedacting || regions.length === 0}
              className="flex-1 px-3 py-2 text-xs font-medium text-white bg-orange-600 rounded hover:bg-orange-700 disabled:bg-slate-400 disabled:text-slate-200"
            >
              {isRedacting ? "Redacting..." : "Apply Redaction"}
            </button>
          </div>
          {onSaveAndNext && (
            <button
              onClick={handleSaveAndNext}
              disabled={isSaving}
              className="w-full px-3 py-2 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:bg-slate-400 disabled:text-slate-200"
            >
              {isSaving ? "Saving..." : "Save & Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        {editorContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-[95vw] h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-slate-700">
          <h3 className="text-lg font-semibold dark:text-slate-100">PHI Region Editor - Screenshot #{screenshotId}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none" aria-label="Close PHI region editor">&times;</button>
        </div>
        {editorContent}
      </div>
    </div>
  );
};
