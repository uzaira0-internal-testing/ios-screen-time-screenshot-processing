import { useState } from "react";
import type { Screenshot } from "@/types";
import type { PreprocessingEventData } from "@/store/preprocessingStore";
import { usePreprocessingStore } from "@/store/preprocessingStore";
import { StageReviewTable } from "./StageReviewTable";
import { PHIRegionEditor } from "./PHIRegionEditor";

const RESULT_HEADERS = ["PHI Found", "Regions", "Preset", ""];

function PHIDetectionTabInner() {
  const [editorScreenshotId, setEditorScreenshotId] = useState<number | null>(null);
  const loadScreenshots = usePreprocessingStore((s) => s.loadScreenshots);
  const loadSummary = usePreprocessingStore((s) => s.loadSummary);

  const handleRegionsSaved = () => {
    loadScreenshots();
    loadSummary();
  };

  const renderResultColumns = (_s: Screenshot, event: PreprocessingEventData | null) => {
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
        <td className="px-3 py-2">
          <button
            onClick={() => setEditorScreenshotId(_s.id)}
            className="px-2 py-1 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
            title="Edit PHI regions"
          >
            Edit Regions
          </button>
        </td>
      </>
    );
  };

  return (
    <>
      <StageReviewTable
        stage="phi_detection"
        resultHeaders={RESULT_HEADERS}
        renderResultColumns={renderResultColumns}
      />
      {editorScreenshotId !== null && (
        <PHIRegionEditor
          screenshotId={editorScreenshotId}
          isOpen={true}
          onClose={() => setEditorScreenshotId(null)}
          onRegionsSaved={handleRegionsSaved}
          onRedactionApplied={() => { handleRegionsSaved(); setEditorScreenshotId(null); }}
        />
      )}
    </>
  );
}

export const PHIDetectionTab = () => <PHIDetectionTabInner />;
