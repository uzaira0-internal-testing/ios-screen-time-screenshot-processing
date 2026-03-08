import { usePreprocessingStore } from "@/store/preprocessingStore";
import type { Screenshot } from "@/types";

interface QueueNavigationBarProps {
  currentScreenshot: Screenshot | undefined;
}

export const QueueNavigationBar = ({ currentScreenshot }: QueueNavigationBarProps) => {
  const queueIndex = usePreprocessingStore((s) => s.queueIndex);
  const queueScreenshotIds = usePreprocessingStore((s) => s.queueScreenshotIds);
  const queueNext = usePreprocessingStore((s) => s.queueNext);
  const queuePrev = usePreprocessingStore((s) => s.queuePrev);
  const exitQueue = usePreprocessingStore((s) => s.exitQueue);

  const total = queueScreenshotIds.length;
  const isFirst = queueIndex === 0;
  const isLast = queueIndex >= total - 1;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
      <button
        onClick={exitQueue}
        className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-md hover:bg-slate-100"
      >
        &larr; Back to Table
      </button>

      <div className="flex items-center gap-1 ml-4">
        <button
          onClick={queuePrev}
          disabled={isFirst}
          className="px-2 py-1 text-sm border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous screenshot"
        >
          &larr;
        </button>
        <span className="px-3 py-1 text-sm font-medium text-slate-700 min-w-[80px] text-center">
          {queueIndex + 1} / {total}
        </span>
        <button
          onClick={queueNext}
          disabled={isLast}
          className="px-2 py-1 text-sm border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next screenshot"
        >
          &rarr;
        </button>
      </div>

      {currentScreenshot && (
        <div className="flex items-center gap-3 ml-4 text-sm text-slate-500">
          <span className="font-mono">#{currentScreenshot.id}</span>
          {currentScreenshot.participant_id && (
            <span>{currentScreenshot.participant_id}</span>
          )}
          {currentScreenshot.screenshot_date && (
            <span>{currentScreenshot.screenshot_date}</span>
          )}
        </div>
      )}

      <div className="ml-auto text-xs text-slate-400">
        &larr; &rarr; navigate &middot; Shift+D clear auto-PHI &middot; Ctrl+Enter save &amp; next &middot; Esc exit
      </div>
    </div>
  );
};
