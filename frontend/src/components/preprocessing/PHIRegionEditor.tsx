import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/services/apiClient";
import { config } from "@/config";
import toast from "react-hot-toast";

interface PHIRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  source: string;
  confidence: number;
  text: string;
}

interface PHIRegionEditorProps {
  screenshotId: number;
  isOpen: boolean;
  onClose: () => void;
  onRegionsSaved: () => void;
  onRedactionApplied: () => void;
}

type Tool = "draw" | "select" | "delete";

const LABELS = ["PERSON_NAME", "DATE", "PHONE", "EMAIL", "ADDRESS", "OTHER"];

export const PHIRegionEditor = ({
  screenshotId,
  isOpen,
  onClose,
  onRegionsSaved,
  onRedactionApplied,
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

  // Load image and regions on open
  useEffect(() => {
    if (!isOpen) return;

    // Load image
    const img = new Image();
    img.crossOrigin = "anonymous";
    const imageUrl = `${config.apiBaseUrl}/screenshots/${screenshotId}/original-image`;
    img.src = imageUrl;
    img.onload = () => setImage(img);

    // Load existing regions
    api.preprocessing.getPHIRegions(screenshotId).then((data: { regions: PHIRegion[] }) => {
      setRegions(data.regions || []);
    }).catch(() => {
      setRegions([]);
    });
  }, [isOpen, screenshotId]);

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
        setRegions((prev) => [
          ...prev,
          { x, y, w, h, label: "OTHER", source: "manual", confidence: 1.0, text: "" },
        ]);
        setSelectedIndex(regions.length);
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

  if (!isOpen) return null;

  const autoCount = regions.filter((r) => r.source !== "manual").length;
  const manualCount = regions.length - autoCount;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-[95vw] h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">PHI Region Editor - Screenshot #{screenshotId}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">x</button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Canvas area */}
          <div className="flex-1 overflow-auto p-4">
            {image ? (
              <canvas
                ref={canvasRef}
                style={{ cursor: getCursor() }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
            ) : (
              <div className="flex items-center justify-center h-64">
                <span className="text-gray-400">Loading image...</span>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-80 border-l flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center gap-1 p-3 border-b">
              {(["select", "draw", "delete"] as Tool[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTool(t)}
                  className={`px-3 py-1.5 text-xs rounded font-medium ${
                    tool === t
                      ? "bg-blue-100 text-blue-700 border border-blue-300"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent"
                  }`}
                >
                  {t === "select" ? "Select" : t === "draw" ? "Draw" : "Delete"}
                </button>
              ))}
            </div>

            {/* Region list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <div className="text-xs text-gray-500 mb-2">
                {autoCount} auto-detected, {manualCount} manual
              </div>
              {regions.map((region, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 p-2 rounded text-xs cursor-pointer ${
                    i === selectedIndex ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-50 border border-transparent"
                  }`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <span className="font-mono text-gray-400 w-4">{i + 1}</span>
                  <span className="text-gray-500">
                    {region.x},{region.y} {region.w}x{region.h}
                  </span>
                  <select
                    value={region.label}
                    onChange={(e) => updateRegion(i, { label: e.target.value })}
                    className="text-xs border rounded px-1 py-0.5 flex-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {LABELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      region.source === "manual" ? "bg-blue-100 text-blue-600" : "bg-red-100 text-red-600"
                    }`}
                  >
                    {region.source === "manual" ? "M" : "A"}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteRegion(i); }}
                    className="text-gray-400 hover:text-red-500"
                    title="Delete region"
                  >
                    x
                  </button>
                </div>
              ))}
              {regions.length === 0 && (
                <div className="text-center text-gray-400 py-8 text-sm">
                  No PHI regions. Use Draw tool to add regions.
                </div>
              )}
            </div>

            {/* Redaction method */}
            <div className="p-3 border-t space-y-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Method:</label>
                <select
                  value={redactionMethod}
                  onChange={(e) => setRedactionMethod(e.target.value)}
                  className="text-xs border rounded px-2 py-1 flex-1"
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
                  className="flex-1 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save Regions"}
                </button>
                <button
                  onClick={handleRedact}
                  disabled={isRedacting || regions.length === 0}
                  className="flex-1 px-3 py-2 text-xs font-medium text-white bg-orange-600 rounded hover:bg-orange-700 disabled:opacity-50"
                >
                  {isRedacting ? "Redacting..." : "Apply Redaction"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
