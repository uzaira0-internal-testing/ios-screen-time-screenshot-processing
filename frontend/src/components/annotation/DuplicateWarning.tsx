interface DuplicateWarningProps {
  duplicateId: number;
  onSkipThis: () => void;
  onGoToDuplicate: () => void;
  isLoading?: boolean;
}

export const DuplicateWarning = ({
  duplicateId,
  onSkipThis,
  onGoToDuplicate,
  isLoading = false,
}: DuplicateWarningProps) => {
  return (
    <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-lg">
      <div className="flex items-start gap-2">
        <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">
          !
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-amber-800">
            Potential Duplicate Detected
          </h4>
          <p className="mt-1 text-sm text-amber-700">
            Screenshot <span className="font-mono font-semibold">#{duplicateId}</span> has
            the same participant, date, app title, and total usage. You may want
            to skip one of them.
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            <button
              onClick={onSkipThis}
              disabled={isLoading}
              className="px-3 py-1 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Skip This One
            </button>
            <button
              onClick={onGoToDuplicate}
              disabled={isLoading}
              className="px-3 py-1 text-xs font-medium bg-white text-amber-700 border border-amber-300 rounded hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Go to #{duplicateId}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
