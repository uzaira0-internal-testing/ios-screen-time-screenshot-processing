import type { HourlyData, Consensus } from "@/types";
import clsx from "clsx";

interface HourlyUsageEditorProps {
  data: HourlyData;
  onChange: (hour: number, value: number) => void;
  consensus?: Consensus;
  readOnly?: boolean;
  title?: string;
}

export const HourlyUsageEditor = ({
  data,
  onChange,
  consensus,
  readOnly = false,
}: HourlyUsageEditorProps) => {
  const handleChange = (hour: number, delta: number) => {
    const currentValue = data[hour] || 0;
    const newValue = Math.max(0, Math.min(60, currentValue + delta));
    onChange(hour, newValue);
  };

  const handleInputChange = (hour: number, value: string) => {
    const numValue = parseInt(value) || 0;
    if (numValue < 0 || numValue > 60) return;
    onChange(hour, numValue);
  };

  const getDisagreementLevel = (
    hour: number,
  ): "none" | "minor" | "major" | null => {
    if (!consensus) return null;
    const disagreement = consensus.disagreements.find((d) => d.hour === hour);
    if (!disagreement) return "none";
    const currentValue = data[hour] || 0;
    const diff = Math.abs(currentValue - disagreement.consensus_value);
    if (diff === 0) return "none";
    if (diff <= 5) return "minor";
    return "major";
  };

  const getCellClassName = (hour: number) => {
    const level = getDisagreementLevel(hour);
    return clsx(
      "w-full text-center text-sm font-medium border rounded-md focus:outline-none focus:ring-2 transition-all py-1",
      {
        "bg-green-50 border-green-200 text-green-700": level === "none",
        "bg-yellow-50 border-yellow-200 text-yellow-700": level === "minor",
        "bg-red-50 border-red-200 text-red-700": level === "major",
        "bg-white border-slate-200 text-slate-700 focus:ring-primary-500 focus:border-primary-500":
          level === null,
        "bg-slate-50 text-slate-400 cursor-not-allowed": readOnly,
      },
    );
  };

  const graphHeight = 200;

  return (
    <div className="w-full" data-testid="hourly-editor">
      {/* Bar Graph - EXACTLY 24 columns */}
      <div
        className="relative bg-white rounded-lg overflow-hidden border border-slate-200"
        style={{ height: graphHeight }}
      >
        <div
          className="absolute inset-0 w-full h-full grid"
          style={{
            gridTemplateColumns: "repeat(24, 1fr)",
          }}
        >
          {Array.from({ length: 24 }, (_, i) => {
            const value = data[i] || 0;
            const heightPercentage = (value / 60) * 100;

            return (
              <div
                key={i}
                className="flex flex-col h-full justify-end items-center border-r border-slate-200 last:border-r-0"
              >
                {/* Bar */}
                <div
                  className="w-4/5 bg-primary-500 border-t border-primary-600/30 transition-all duration-300 rounded-t-md"
                  style={{
                    height: `${heightPercentage}%`,
                    minHeight: value > 0 ? "2px" : "0",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Controls grid - EXACTLY 24 columns to match bar graph above */}
      <div
        className="w-full grid gap-2 mt-4"
        style={{ gridTemplateColumns: "repeat(24, 1fr)" }}
      >
        {Array.from({ length: 24 }, (_, i) => {
          const value = data[i] || 0;

          return (
            <div key={i} className="flex flex-col items-center gap-1">
              {/* X-Axis Label */}
              <div className="text-[10px] text-slate-500 font-semibold text-center">
                {i}h
              </div>

              <button
                type="button"
                onClick={() => handleChange(i, 1)}
                disabled={readOnly}
                className="w-full h-5 flex items-center justify-center text-[10px] bg-slate-100 hover:bg-primary-50 hover:text-primary-600 rounded text-slate-600 disabled:opacity-50 transition-colors"
              >
                ▲
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={value}
                onChange={(e) => handleInputChange(i, e.target.value)}
                disabled={readOnly}
                className={getCellClassName(i)}
                style={{ appearance: "textfield" }}
                data-testid={`hour-input-${i}`}
              />
              <button
                type="button"
                onClick={() => handleChange(i, -1)}
                disabled={readOnly}
                className="w-full h-5 flex items-center justify-center text-[10px] bg-slate-100 hover:bg-primary-50 hover:text-primary-600 rounded text-slate-600 disabled:opacity-50 transition-colors"
              >
                ▼
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
