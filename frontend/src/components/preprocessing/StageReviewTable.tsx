import { usePreprocessingStore } from "@/store/preprocessingStore";
import type { Stage, StageStatus, PreprocessingEventData } from "@/store/preprocessingStore";
import type { Screenshot } from "@/types";
import { config } from "@/config";

const IMAGE_URL_PREFIX = config.apiBaseUrl + "/screenshots";

interface StageReviewTableProps {
  stage: Stage;
  renderResultColumns: (screenshot: Screenshot, event: PreprocessingEventData | null) => React.ReactNode;
  resultHeaders: string[];
}

const STATUS_BADGES: Record<StageStatus, { label: string; classes: string }> = {
  completed: { label: "Done", classes: "bg-green-100 text-green-700" },
  invalidated: { label: "Invalidated", classes: "bg-orange-100 text-orange-700" },
  pending: { label: "Pending", classes: "bg-gray-100 text-gray-500" },
  running: { label: "Running", classes: "bg-blue-100 text-blue-600" },
  failed: { label: "Failed", classes: "bg-red-100 text-red-700" },
};

function getCurrentEvent(screenshot: Screenshot, stage: Stage): PreprocessingEventData | null {
  const pp = (screenshot.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
  if (!pp) return null;
  const currentEvents = pp.current_events as Record<string, number | null> | undefined;
  const events = pp.events as PreprocessingEventData[] | undefined;
  if (!currentEvents || !events) return null;
  const eid = currentEvents[stage];
  if (!eid) return null;
  return events.find((e) => e.event_id === eid) ?? null;
}

export const StageReviewTable = ({
  stage,
  renderResultColumns,
  resultHeaders,
}: StageReviewTableProps) => {
  const screenshots = usePreprocessingStore((s) => s.getScreenshotsForStage(stage));
  const getScreenshotStageStatus = usePreprocessingStore((s) => s.getScreenshotStageStatus);
  const isScreenshotException = usePreprocessingStore((s) => s.isScreenshotException);
  const loadEventLog = usePreprocessingStore((s) => s.loadEventLog);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2 w-16">Thumb</th>
            <th className="px-3 py-2 w-16">ID</th>
            <th className="px-3 py-2">Participant</th>
            <th className="px-3 py-2 w-28">Status</th>
            {resultHeaders.map((h) => (
              <th key={h} className="px-3 py-2">{h}</th>
            ))}
            <th className="px-3 py-2 w-16">Log</th>
          </tr>
        </thead>
        <tbody>
          {screenshots.map((s) => {
            const status = getScreenshotStageStatus(s, stage);
            const isException = isScreenshotException(s, stage);
            const event = getCurrentEvent(s, stage);
            const badge = STATUS_BADGES[status] ?? STATUS_BADGES.pending;

            return (
              <tr
                key={s.id}
                className={`border-b border-gray-100 hover:bg-gray-50 ${
                  isException ? "bg-yellow-50" : ""
                } ${status === "invalidated" ? "bg-orange-50/40" : ""}`}
              >
                <td className="px-3 py-2">
                  <img
                    src={`${IMAGE_URL_PREFIX}/${s.id}/image`}
                    alt={`Screenshot ${s.id}`}
                    className="w-10 h-14 object-cover rounded"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-gray-600">{s.id}</td>
                <td className="px-3 py-2">{s.participant_id || "\u2014"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                    {isException && (
                      <span
                        className="text-yellow-500"
                        title="Needs review"
                      >
                        !
                      </span>
                    )}
                    {status === "invalidated" && (
                      <span
                        className="text-orange-400 text-xs"
                        title="Upstream stage was re-run. Click Run to update."
                      >
                        (stale)
                      </span>
                    )}
                    {status === "running" && (
                      <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                    )}
                  </div>
                </td>
                {renderResultColumns(s, event)}
                <td className="px-3 py-2">
                  <button
                    onClick={() => loadEventLog(s.id)}
                    className="p-1 text-gray-400 hover:text-primary-600"
                    title="View event log"
                  >
                    ...
                  </button>
                </td>
              </tr>
            );
          })}
          {screenshots.length === 0 && (
            <tr>
              <td
                colSpan={4 + resultHeaders.length + 1}
                className="px-3 py-8 text-center text-gray-400"
              >
                No screenshots match current filter
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
