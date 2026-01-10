import { ReactNode } from "react";
import clsx from "clsx";

interface ActionButtonsProps {
  onSkip: () => void;
  onSubmit: () => void;
  isLoading?: boolean;
  canSubmit?: boolean;
  shortcuts?: ReactNode;
}

export const ActionButtons = ({
  onSkip,
  onSubmit,
  isLoading = false,
  canSubmit = false,
  shortcuts,
}: ActionButtonsProps) => {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2">
        <button
          onClick={onSkip}
          disabled={isLoading}
          className="w-full px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Skip (Esc)
        </button>

        <button
          onClick={onSubmit}
          disabled={isLoading || !canSubmit}
          className={clsx(
            "w-full px-3 py-2 text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            canSubmit
              ? "bg-primary-600 hover:bg-primary-700 text-white"
              : "bg-gray-300 text-gray-500",
          )}
        >
          Submit (Enter)
        </button>
      </div>

      {shortcuts && (
        <div className="text-xs text-gray-500 text-center">{shortcuts}</div>
      )}
    </div>
  );
};
