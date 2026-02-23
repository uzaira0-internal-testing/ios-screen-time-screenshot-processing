import type { Screenshot } from "@/types";

interface PHIDetectionTabProps {
  screenshots: Screenshot[];
  imageUrlPrefix: string;
  onRunOne: (id: number) => void;
  runningIds: Set<number>;
}

export const PHIDetectionTab = ({
  screenshots,
  imageUrlPrefix,
  onRunOne,
  runningIds,
}: PHIDetectionTabProps) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2 w-16">Thumb</th>
            <th className="px-3 py-2 w-16">ID</th>
            <th className="px-3 py-2">Participant</th>
            <th className="px-3 py-2 w-24">PHI Found</th>
            <th className="px-3 py-2 w-24">Regions</th>
            <th className="px-3 py-2">Preset</th>
            <th className="px-3 py-2 w-16">Run</th>
          </tr>
        </thead>
        <tbody>
          {screenshots.map((s) => {
            const pp = (s.processing_metadata as any)?.preprocessing;
            const pd = pp?.phi_detection;
            return (
              <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <img
                    src={`${imageUrlPrefix}/${s.id}/image`}
                    alt={`Screenshot ${s.id}`}
                    className="w-10 h-14 object-cover rounded"
                  />
                </td>
                <td className="px-3 py-2 font-mono text-gray-600">{s.id}</td>
                <td className="px-3 py-2">{s.participant_id || "—"}</td>
                <td className="px-3 py-2">
                  {pd ? (
                    pd.phi_detected ? (
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                        Yes
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                        Clean
                      </span>
                    )
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {pd ? pd.regions_count : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {pd?.preset || "—"}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onRunOne(s.id)}
                    disabled={runningIds.has(s.id)}
                    className="p-1 text-gray-500 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Run preprocessing"
                  >
                    {runningIds.has(s.id) ? (
                      <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
                    ) : (
                      "▶"
                    )}
                  </button>
                </td>
              </tr>
            );
          })}
          {screenshots.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                No screenshots in this group
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
