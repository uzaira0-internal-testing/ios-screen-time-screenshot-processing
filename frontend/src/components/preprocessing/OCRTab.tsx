import type { Screenshot } from "@/types";
import type { PreprocessingEventData } from "@/store/preprocessingStore";
import { StageReviewTable } from "./StageReviewTable";

const RESULT_HEADERS = ["Status", "Title", "Total", "Method", "Issues"];

function OCRTabInner() {
  const renderResultColumns = (_s: Screenshot, event: PreprocessingEventData | null) => {
    const result = event?.result as Record<string, unknown> | undefined;
    const status = result?.processing_status as string | undefined;
    const issues = (result?.issues as string[]) ?? [];

    return (
      <>
        <td className="px-3 py-2">
          {result ? (
            status === "completed" ? (
              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                OK
              </span>
            ) : status === "failed" ? (
              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                Failed
              </span>
            ) : (
              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                {status ?? "Unknown"}
              </span>
            )
          ) : (
            <span className="text-slate-400">{"\u2014"}</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={result?.extracted_title as string ?? ""}>
          {(result?.extracted_title as string) || "\u2014"}
        </td>
        <td className="px-3 py-2 text-xs font-mono">
          {(result?.extracted_total as string) || "\u2014"}
        </td>
        <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
          {(result?.processing_method as string) || "\u2014"}
        </td>
        <td className="px-3 py-2 text-xs">
          {issues.length > 0 ? (
            <span className="text-amber-600 dark:text-amber-400" title={issues.join("; ")}>
              {issues.length} issue{issues.length !== 1 ? "s" : ""}
            </span>
          ) : result ? (
            <span className="text-slate-400">None</span>
          ) : (
            "\u2014"
          )}
        </td>
      </>
    );
  };

  return (
    <StageReviewTable
      stage="ocr"
      resultHeaders={RESULT_HEADERS}
      renderResultColumns={renderResultColumns}
    />
  );
}

export const OCRTab = OCRTabInner;
