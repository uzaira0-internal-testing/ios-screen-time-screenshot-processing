interface PreprocessingOptionsProps {
  preset: string;
  onPresetChange: (preset: string) => void;
  method: string;
  onMethodChange: (method: string) => void;
  phiEnabled: boolean;
  onPhiEnabledChange: (enabled: boolean) => void;
  runOcrAfter: boolean;
  onRunOcrAfterChange: (run: boolean) => void;
  onRunAll: () => void;
  isRunningAll: boolean;
  disabled?: boolean;
}

const PRESETS = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "hipaa_compliant", label: "HIPAA Compliant" },
  { value: "thorough", label: "Thorough" },
];

const METHODS = [
  { value: "redbox", label: "Red Box" },
  { value: "blackbox", label: "Black Box" },
  { value: "pixelate", label: "Pixelate" },
];

export const PreprocessingOptions = ({
  preset,
  onPresetChange,
  method,
  onMethodChange,
  phiEnabled,
  onPhiEnabledChange,
  runOcrAfter,
  onRunOcrAfterChange,
  onRunAll,
  isRunningAll,
  disabled,
}: PreprocessingOptionsProps) => {
  return (
    <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Preset:</label>
        <select
          value={preset}
          onChange={(e) => onPresetChange(e.target.value)}
          className="text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-md px-2 py-1"
          disabled={disabled}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Method:</label>
        <select
          value={method}
          onChange={(e) => onMethodChange(e.target.value)}
          className="text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-md px-2 py-1"
          disabled={disabled}
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={phiEnabled}
          onChange={(e) => onPhiEnabledChange(e.target.checked)}
          className="rounded border-slate-300 dark:border-slate-600"
          disabled={disabled}
        />
        <span className="text-slate-700 dark:text-slate-200">PHI Detection</span>
      </label>

      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={runOcrAfter}
          onChange={(e) => onRunOcrAfterChange(e.target.checked)}
          className="rounded border-slate-300 dark:border-slate-600"
          disabled={disabled}
        />
        <span className="text-slate-700 dark:text-slate-200">Run OCR After</span>
      </label>

      <button
        onClick={onRunAll}
        disabled={disabled || isRunningAll}
        className="ml-auto px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isRunningAll ? "Queuing..." : "Run All"}
      </button>
    </div>
  );
};
