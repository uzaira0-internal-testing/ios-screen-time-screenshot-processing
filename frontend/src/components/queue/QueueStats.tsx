import { useEffect } from "react";
import { useAnnotation } from "@/hooks/useAnnotationWithDI";

interface QueueStatsProps {
  compact?: boolean;
}

export const QueueStats = ({ compact = false }: QueueStatsProps) => {
  const { queueStats, loadQueueStats } = useAnnotation();

  useEffect(() => {
    loadQueueStats();
  }, [loadQueueStats]);

  if (!queueStats) {
    return null;
  }

  // Compact version for side panel
  if (compact) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Total</span>
          <span className="font-semibold text-slate-700">
            {queueStats.total_screenshots}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Pending</span>
          <span className="font-semibold text-primary-600">
            {queueStats.pending_screenshots}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Done</span>
          <span className="font-semibold text-green-600">
            {queueStats.completed_screenshots}
          </span>
        </div>
        {queueStats.skipped > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Skipped</span>
            <span className="font-semibold text-slate-600">
              {queueStats.skipped}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Full version for main page
  const mainStats = [
    {
      label: "Total Screenshots",
      value: queueStats.total_screenshots,
      color: "text-slate-600",
    },
    {
      label: "Pending",
      value: queueStats.pending_screenshots,
      color: "text-primary-600",
    },
    {
      label: "Preprocessed",
      value: queueStats.completed_screenshots,
      color: "text-green-600",
    },
    {
      label: "Total Annotations",
      value: queueStats.total_annotations,
      color: "text-primary-600",
    },
  ];

  const processingStats = [
    {
      label: "Auto-Processed",
      value: queueStats.auto_processed ?? 0,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Pending",
      value: queueStats.pending ?? 0,
      color: "text-primary-600",
      bg: "bg-primary-50",
    },
    {
      label: "Failed",
      value: queueStats.failed ?? 0,
      color: "text-red-600",
      bg: "bg-red-50",
    },
    {
      label: "Skipped",
      value: queueStats.skipped ?? 0,
      color: "text-slate-600",
      bg: "bg-slate-50",
    },
  ];

  const hasProcessingStats = processingStats.some((s) => s.value > 0);

  return (
    <div className="bg-white rounded-lg shadow-md border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">
        Queue Statistics
      </h3>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {mainStats.map((stat) => (
          <div
            key={stat.label}
            className="text-center p-3 bg-slate-50 rounded-lg"
          >
            <div className={`text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </div>
            <div className="text-xs text-slate-600 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {hasProcessingStats && (
        <>
          <h4 className="text-sm font-semibold text-slate-700 mb-3 mt-4">
            Processing Status
          </h4>
          <div className="space-y-2">
            {processingStats
              .filter((s) => s.value > 0)
              .map((stat) => (
                <div
                  key={stat.label}
                  className={`flex items-center justify-between p-2 ${stat.bg} rounded`}
                >
                  <span className="text-sm text-slate-700">{stat.label}</span>
                  <span className={`text-sm font-bold ${stat.color}`}>
                    {stat.value}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
};
