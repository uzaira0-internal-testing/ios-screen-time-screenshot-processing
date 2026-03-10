import { useEffect, useState, useCallback, useRef } from "react";
import { Layout } from "@/components/layout/Layout";
import { useScreenshotService } from "@/core/hooks/useServices";
import type { QueueStats } from "@/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Play, Square, RotateCcw } from "lucide-react";

export const WASMPreprocessingPage = () => {
  const screenshotService = useScreenshotService();
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);

  const loadStats = useCallback(async () => {
    const s = await screenshotService.getStats();
    setStats(s);
  }, [screenshotService]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleProcess = useCallback(async () => {
    abortRef.current = false;
    setIsProcessing(true);

    // Get all pending screenshots
    const result = await screenshotService.getList({
      processing_status: "pending",
      page: 1,
      page_size: 10000,
    });
    const pending = result.items;
    setProgress({ current: 0, total: pending.length });

    for (let i = 0; i < pending.length; i++) {
      if (abortRef.current) break;
      const screenshot = pending[i];
      if (!screenshot) continue;

      try {
        await screenshotService.processIfNeeded(screenshot);
      } catch (error) {
        console.error(`Failed to process screenshot ${screenshot.id}:`, error);
      }
      setProgress({ current: i + 1, total: pending.length });

      // Refresh stats every 10 screenshots
      if ((i + 1) % 10 === 0) {
        loadStats();
      }
    }

    setIsProcessing(false);
    loadStats();
  }, [screenshotService, loadStats]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
  }, []);

  const pendingCount = stats?.pending ?? 0;
  const completedCount = stats?.auto_processed ?? 0;
  const failedCount = stats?.failed ?? 0;
  const totalCount = stats?.total_screenshots ?? 0;

  return (
    <Layout>
      <div className="space-y-6 py-8">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Preprocessing
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Run OCR processing on loaded screenshots to extract titles, totals, and hourly bar data.
        </p>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card padding="md">
            <div className="text-center">
              <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{totalCount}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Total</div>
            </div>
          </Card>
          <Card padding="md">
            <div className="text-center">
              <div className="text-3xl font-bold text-amber-600">{pendingCount}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Pending</div>
            </div>
          </Card>
          <Card padding="md">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{completedCount}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Processed</div>
            </div>
          </Card>
          <Card padding="md">
            <div className="text-center">
              <div className="text-3xl font-bold text-red-600">{failedCount}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Failed</div>
            </div>
          </Card>
        </div>

        {/* Progress bar during processing */}
        {isProcessing && progress.total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>Processing screenshots (OCR)...</span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-600 rounded-full transition-all duration-200"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          {!isProcessing ? (
            <Button
              variant="primary"
              onClick={handleProcess}
              disabled={pendingCount === 0}
              icon={<Play className="h-4 w-4" />}
            >
              Process {pendingCount} Pending Screenshot{pendingCount !== 1 ? "s" : ""}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={handleStop}
              icon={<Square className="h-4 w-4" />}
            >
              Stop
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={loadStats}
            icon={<RotateCcw className="h-4 w-4" />}
          >
            Refresh
          </Button>
        </div>

        {pendingCount === 0 && !isProcessing && totalCount > 0 && (
          <p className="text-sm text-green-600 dark:text-green-400">
            All screenshots have been processed. Go to Annotate to start annotating.
          </p>
        )}

        {totalCount === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No screenshots loaded yet. Go to Home to load a folder.
          </p>
        )}
      </div>
    </Layout>
  );
};
