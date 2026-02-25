import type { Screenshot } from "@/types";
import type { PreprocessingEventData } from "@/store/preprocessingStore";
import { StageReviewTable } from "./StageReviewTable";

const RESULT_HEADERS = ["Redacted", "Regions", "Method"];

function renderResultColumns(_s: Screenshot, event: PreprocessingEventData | null) {
  const result = event?.result as Record<string, unknown> | undefined;

  return (
    <>
      <td className="px-3 py-2">
        {result ? (
          result.redacted ? (
            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
              Yes
            </span>
          ) : (
            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
              No
            </span>
          )
        ) : (
          <span className="text-gray-400">{"\u2014"}</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {result ? (result.regions_redacted as number) : "\u2014"}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {(result?.method as string) || "\u2014"}
      </td>
    </>
  );
}

export const PHIRedactionTab = () => {
  return (
    <StageReviewTable
      stage="phi_redaction"
      resultHeaders={RESULT_HEADERS}
      renderResultColumns={renderResultColumns}
    />
  );
};
