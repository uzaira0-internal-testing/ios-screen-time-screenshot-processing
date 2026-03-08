interface UploadProgressBarProps {
  completed: number;
  total: number;
  errors: string[];
}

export const UploadProgressBar = ({ completed, total, errors }: UploadProgressBarProps) => {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const batchSize = 60;
  const currentBatch = Math.floor(completed / batchSize) + 1;
  const totalBatches = Math.ceil(total / batchSize);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">
          Uploading{totalBatches > 1 ? ` batch ${currentBatch}/${totalBatches}` : ""}
          {" "}({completed}/{total})
        </span>
        <span className="font-medium text-slate-700">{pct}%</span>
      </div>
      <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {errors.length > 0 && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm font-medium text-red-700 mb-1">
            {errors.length} error{errors.length !== 1 ? "s" : ""}:
          </p>
          <ul className="text-xs text-red-600 space-y-0.5 max-h-24 overflow-y-auto">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
