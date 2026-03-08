interface SaveStatusIndicatorProps {
  isSaving: boolean;
  lastSaved: Date | null;
  timeSinceLastSave: string;
}

export function SaveStatusIndicator({
  isSaving,
  lastSaved,
  timeSinceLastSave,
}: SaveStatusIndicatorProps) {
  return (
    <div
      className={`text-xs text-center py-2 px-3 rounded-md transition-all duration-300 ${
        isSaving
          ? "bg-primary-50 text-primary-700 border border-primary-200 dark:bg-primary-900/20 dark:text-primary-400 dark:border-primary-700"
          : lastSaved
            ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-700"
            : "bg-slate-50 text-slate-500 border border-slate-200 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600"
      }`}
      data-testid="auto-save-status"
    >
      {isSaving ? (
        <span className="flex items-center justify-center gap-2">
          <div className="animate-spin h-3 w-3 border-2 border-primary-500 border-t-transparent rounded-full"></div>
          <span className="font-medium">Saving changes...</span>
        </span>
      ) : lastSaved ? (
        <span className="flex items-center justify-center gap-1">
          <svg
            className="w-4 h-4 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span className="font-medium">Saved {timeSinceLastSave}</span>
        </span>
      ) : (
        <span className="flex items-center justify-center gap-1">
          <svg
            className="w-3 h-3 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          Auto-save enabled
        </span>
      )}
    </div>
  );
}
