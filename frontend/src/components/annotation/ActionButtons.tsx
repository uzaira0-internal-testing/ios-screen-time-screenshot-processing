import { ReactNode } from "react";
import clsx from "clsx";
import { config } from "@/config";

interface ActionButtonsProps {
  onSkip: () => void;
  onSave: () => void;
  isLoading?: boolean;
  canSave?: boolean;
  shortcuts?: ReactNode;
}

export const ActionButtons = ({
  onSkip,
  onSave,
  isLoading = false,
  canSave = false,
  shortcuts,
}: ActionButtonsProps) => {
  const saveLabel = config.isLocalMode ? "Save (Enter)" : "Submit (Enter)";

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2">
        <button
          onClick={onSkip}
          disabled={isLoading}
          className="w-full px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200 text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Skip (Esc)
        </button>

        <button
          onClick={onSave}
          disabled={isLoading || !canSave}
          className={clsx(
            "w-full px-3 py-2 text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            canSave
              ? "bg-primary-600 hover:bg-primary-700 text-white"
              : "bg-slate-300 text-slate-500 dark:bg-slate-600 dark:text-slate-400",
          )}
        >
          {saveLabel}
        </button>
      </div>

      {shortcuts && (
        <div className="text-xs text-slate-500 text-center">{shortcuts}</div>
      )}
    </div>
  );
};
