import { useState } from "react";
import type { Screenshot } from "@/types";
import type { PreprocessingEventData } from "@/store/preprocessingStore";
import { usePreprocessingStore } from "@/store/preprocessingStore";
import { StageReviewTable } from "./StageReviewTable";
import { CropAdjustModal } from "./CropAdjustModal";

const RESULT_HEADERS = ["Device", "Cropped", "Patched", "Original Size", ""];

function CroppingTabInner() {
  const [cropModalScreenshotId, setCropModalScreenshotId] = useState<number | null>(null);
  const loadScreenshots = usePreprocessingStore((s) => s.loadScreenshots);
  const loadSummary = usePreprocessingStore((s) => s.loadSummary);

  const handleCropApplied = () => {
    loadScreenshots();
    loadSummary();
  };

  const renderResultColumns = (s: Screenshot, event: PreprocessingEventData | null) => {
    const result = event?.result as Record<string, unknown> | undefined;
    const params = event?.params as Record<string, unknown> | undefined;

    return (
      <>
        <td className="px-3 py-2 text-xs">
          {(params?.auto_detected_device as string) || s.device_type || "\u2014"}
        </td>
        <td className="px-3 py-2">
          {result ? (
            result.was_cropped ? (
              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                {result.manual ? "Manual" : "Yes"}
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
        <td className="px-3 py-2">
          {result ? (
            result.was_patched ? (
              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                Yes
              </span>
            ) : (
              <span className="text-gray-400 text-xs">No</span>
            )
          ) : (
            <span className="text-gray-400">{"\u2014"}</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-gray-600">
          {result?.original_dimensions
            ? `${(result.original_dimensions as number[])[0]} x ${(result.original_dimensions as number[])[1]}`
            : "\u2014"}
        </td>
        <td className="px-3 py-2">
          <button
            onClick={() => setCropModalScreenshotId(s.id)}
            className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
            title="Adjust crop manually"
          >
            Edit Crop
          </button>
        </td>
      </>
    );
  };

  return (
    <>
      <StageReviewTable
        stage="cropping"
        resultHeaders={RESULT_HEADERS}
        renderResultColumns={renderResultColumns}
      />
      {cropModalScreenshotId !== null && (
        <CropAdjustModal
          screenshotId={cropModalScreenshotId}
          isOpen={true}
          onClose={() => setCropModalScreenshotId(null)}
          onCropApplied={handleCropApplied}
        />
      )}
    </>
  );
}

export const CroppingTab = () => <CroppingTabInner />;
