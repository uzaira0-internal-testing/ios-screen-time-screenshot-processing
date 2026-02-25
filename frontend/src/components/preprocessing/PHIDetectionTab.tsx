import type { Screenshot } from "@/types";
import type { PreprocessingEventData } from "@/store/preprocessingStore";
import { StageReviewTable } from "./StageReviewTable";

const RESULT_HEADERS = ["PHI Found", "Regions", "Preset"];

function renderResultColumns(_s: Screenshot, event: PreprocessingEventData | null) {
  const result = event?.result as Record<string, unknown> | undefined;

  return (
    <>
      <td className="px-3 py-2">
        {result ? (
          result.phi_detected ? (
            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
              Yes
            </span>
          ) : (
            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
              Clean
            </span>
          )
        ) : (
          <span className="text-gray-400">{"\u2014"}</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {result ? (result.regions_count as number) : "\u2014"}
      </td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {(result?.preset as string) || "\u2014"}
      </td>
    </>
  );
}

export const PHIDetectionTab = () => {
  return (
    <StageReviewTable
      stage="phi_detection"
      resultHeaders={RESULT_HEADERS}
      renderResultColumns={renderResultColumns}
    />
  );
};
