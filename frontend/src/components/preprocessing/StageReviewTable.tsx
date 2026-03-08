import { useEffect, useMemo, useRef, useState } from "react";
import { usePreprocessingStore } from "@/store/preprocessingStore";
import type { Stage, StageStatus, PreprocessingEventData } from "@/store/preprocessingStore";
import type { Screenshot } from "@/types";
import { config } from "@/config";

const IMAGE_URL_PREFIX = config.apiBaseUrl + "/screenshots";

type SortColumn = "id" | "participant" | "status";
type SortDirection = "asc" | "desc";

interface StageReviewTableProps {
  stage: Stage;
  renderResultColumns: (screenshot: Screenshot, event: PreprocessingEventData | null) => React.ReactNode;
  resultHeaders: string[];
}

const STATUS_BADGES: Record<StageStatus, { label: string; classes: string }> = {
  completed: { label: "Done", classes: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" },
  invalidated: { label: "Invalidated", classes: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" },
  pending: { label: "Pending", classes: "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400" },
  running: { label: "Running", classes: "bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400" },
  failed: { label: "Failed", classes: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" },
};

const STATUS_SORT_ORDER: Record<string, number> = {
  running: 0,
  failed: 1,
  pending: 2,
  invalidated: 3,
  completed: 4,
};

export function getCurrentEvent(screenshot: Screenshot, stage: Stage): PreprocessingEventData | null {
  const pp = (screenshot.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
  if (!pp) return null;
  const currentEvents = pp.current_events as Record<string, number | null> | undefined;
  const events = pp.events as PreprocessingEventData[] | undefined;
  if (!currentEvents || !events) return null;
  const eid = currentEvents[stage];
  if (!eid) return null;
  return events.find((e) => e.event_id === eid) ?? null;
}

function SortIcon({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: SortDirection }) {
  if (column !== sortColumn) {
    return <span className="text-slate-300 ml-1">&#8597;</span>;
  }
  return <span className="text-primary-600 ml-1">{sortDirection === "asc" ? "\u25B2" : "\u25BC"}</span>;
}

export const StageReviewTable = ({
  stage,
  renderResultColumns,
  resultHeaders,
}: StageReviewTableProps) => {
  const allScreenshots = usePreprocessingStore((s) => s.screenshots);
  const filter = usePreprocessingStore((s) => s.filter);
  const getScreenshotStageStatus = usePreprocessingStore((s) => s.getScreenshotStageStatus);
  const isScreenshotException = usePreprocessingStore((s) => s.isScreenshotException);
  const loadEventLog = usePreprocessingStore((s) => s.loadEventLog);
  const highlightedScreenshotId = usePreprocessingStore((s) => s.highlightedScreenshotId);
  const setHighlightedScreenshotId = usePreprocessingStore((s) => s.setHighlightedScreenshotId);

  const [sortColumn, setSortColumn] = useState<SortColumn>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Memoize filtered + sorted screenshots
  const screenshots = useMemo(() => {
    let filtered = allScreenshots;
    if (filter !== "all") {
      filtered = allScreenshots.filter((s) => {
        const status = getScreenshotStageStatus(s, stage);
        switch (filter) {
          case "completed": return status === "completed";
          case "pending": return status === "pending";
          case "invalidated": return status === "invalidated";
          case "needs_review": return isScreenshotException(s, stage);
          default: return true;
        }
      });
    }

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "id":
          cmp = a.id - b.id;
          break;
        case "participant":
          cmp = (a.participant_id || "").localeCompare(b.participant_id || "");
          break;
        case "status": {
          const sa = getScreenshotStageStatus(a, stage);
          const sb = getScreenshotStageStatus(b, stage);
          cmp = (STATUS_SORT_ORDER[sa] ?? 99) - (STATUS_SORT_ORDER[sb] ?? 99);
          break;
        }
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [allScreenshots, filter, stage, getScreenshotStageStatus, isScreenshotException, sortColumn, sortDirection]);

  const enterQueue = usePreprocessingStore((s) => s.enterQueue);

  const highlightedRef = useRef<HTMLTableRowElement>(null);

  // Auto-scroll to highlighted screenshot
  useEffect(() => {
    if (highlightedScreenshotId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      // Clear highlight after 5 seconds
      const timer = setTimeout(() => setHighlightedScreenshotId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [highlightedScreenshotId, setHighlightedScreenshotId]);

  const sortableThClass = "px-3 py-2 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300 transition-colors";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
            <th className="px-3 py-2 w-16">Thumb</th>
            <th className={`${sortableThClass} w-16`} onClick={() => handleSort("id")}>
              ID <SortIcon column="id" sortColumn={sortColumn} sortDirection={sortDirection} />
            </th>
            <th className={sortableThClass} onClick={() => handleSort("participant")}>
              Participant <SortIcon column="participant" sortColumn={sortColumn} sortDirection={sortDirection} />
            </th>
            <th className={`${sortableThClass} w-28`} onClick={() => handleSort("status")}>
              Status <SortIcon column="status" sortColumn={sortColumn} sortDirection={sortDirection} />
            </th>
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
            const isHighlighted = s.id === highlightedScreenshotId;

            return (
              <tr
                key={s.id}
                ref={isHighlighted ? highlightedRef : undefined}
                className={`border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 ${
                  isHighlighted ? "bg-primary-50 dark:bg-primary-900/20 ring-2 ring-primary-300" : ""
                } ${isException ? "bg-yellow-50 dark:bg-yellow-900/20" : ""} ${
                  status === "invalidated" ? "bg-orange-50/40 dark:bg-orange-900/20" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <button
                    onClick={() => {
                      const ids = screenshots.map((ss) => ss.id);
                      const idx = ids.indexOf(s.id);
                      enterQueue(ids, idx >= 0 ? idx : 0);
                    }}
                    className="block cursor-pointer hover:ring-2 hover:ring-primary-300 rounded transition-shadow"
                    title="Open in review queue"
                    aria-label={`Review screenshot ${s.id} in queue`}
                  >
                    <img
                      src={`${IMAGE_URL_PREFIX}/${s.id}/image`}
                      alt={`Screenshot ${s.id}`}
                      className="w-10 h-14 object-cover rounded bg-slate-200"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.src = ""; }}
                    />
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">{s.id}</td>
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
                      <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-primary-500 rounded-full animate-spin" />
                    )}
                  </div>
                </td>
                {renderResultColumns(s, event)}
                <td className="px-3 py-2">
                  <button
                    onClick={() => loadEventLog(s.id)}
                    className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                    title="View event log"
                    aria-label={`View event log for screenshot ${s.id}`}
                  >
                    Log
                  </button>
                </td>
              </tr>
            );
          })}
          {screenshots.length === 0 && (
            <tr>
              <td
                colSpan={4 + resultHeaders.length + 1}
                className="px-3 py-8 text-center text-slate-400 dark:text-slate-500"
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
