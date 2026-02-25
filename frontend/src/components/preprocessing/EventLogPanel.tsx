import { usePreprocessingStore } from "@/store/preprocessingStore";

const STAGE_LABELS: Record<string, string> = {
  device_detection: "Device Detection",
  cropping: "Cropping",
  phi_detection: "PHI Detection",
  phi_redaction: "PHI Redaction",
};

export const EventLogPanel = () => {
  const eventLog = usePreprocessingStore((s) => s.eventLog);
  const selectedScreenshotId = usePreprocessingStore((s) => s.selectedScreenshotId);
  const clearEventLog = usePreprocessingStore((s) => s.clearEventLog);

  if (!eventLog || !selectedScreenshotId) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-900">
          Event Log - Screenshot #{selectedScreenshotId}
        </h3>
        <button
          onClick={clearEventLog}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          x
        </button>
      </div>

      {/* Stage status summary */}
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50">
        <div className="flex flex-wrap gap-2">
          {Object.entries(eventLog.stage_status).map(([stage, status]) => (
            <div key={stage} className="flex items-center gap-1">
              <span className="text-xs text-gray-500">
                {STAGE_LABELS[stage] ?? stage}:
              </span>
              <span
                className={`text-xs font-medium ${
                  status === "completed"
                    ? "text-green-600"
                    : status === "invalidated"
                      ? "text-orange-500"
                      : status === "failed"
                        ? "text-red-500"
                        : status === "running"
                          ? "text-blue-500"
                          : "text-gray-400"
                }`}
              >
                {status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {eventLog.events.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No events recorded yet
          </p>
        ) : (
          [...eventLog.events].reverse().map((event) => {
            const isCurrent = eventLog.current_events[event.stage] === event.event_id;
            const isError = "error" in event.result;

            return (
              <div
                key={event.event_id}
                className={`rounded-lg border p-3 text-xs ${
                  isCurrent
                    ? "border-primary-200 bg-primary-50/30"
                    : isError
                      ? "border-red-200 bg-red-50/30"
                      : "border-gray-100 bg-white opacity-60"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-700">
                      #{event.event_id}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        event.source === "auto"
                          ? "bg-blue-100 text-blue-600"
                          : "bg-purple-100 text-purple-600"
                      }`}
                    >
                      {event.source}
                    </span>
                    <span className="text-gray-500">
                      {STAGE_LABELS[event.stage] ?? event.stage}
                    </span>
                    {isCurrent && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-600">
                        current
                      </span>
                    )}
                  </div>
                  {event.supersedes && (
                    <span className="text-gray-400">
                      replaces #{event.supersedes}
                    </span>
                  )}
                </div>
                <div className="text-gray-400 mb-1">
                  {new Date(event.timestamp).toLocaleString()}
                </div>
                {/* Result summary */}
                <div className="mt-1 text-gray-600">
                  {isError ? (
                    <span className="text-red-600">
                      Error: {event.result.error as string}
                    </span>
                  ) : (
                    <pre className="whitespace-pre-wrap break-all text-[10px] bg-gray-50 rounded p-1.5 max-h-24 overflow-y-auto">
                      {JSON.stringify(event.result, null, 1)}
                    </pre>
                  )}
                </div>
                {event.output_file && (
                  <div className="mt-1 text-gray-400 truncate" title={event.output_file}>
                    Output: {event.output_file.split("/").pop()}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
        Base: {eventLog.base_file_path.split("/").pop()}
      </div>
    </div>
  );
};
