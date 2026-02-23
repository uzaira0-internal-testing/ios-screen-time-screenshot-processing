import type { Screenshot } from "@/types";

interface DeviceDetectionTabProps {
  screenshots: Screenshot[];
  imageUrlPrefix: string;
  onRunOne: (id: number) => void;
  runningIds: Set<number>;
}

export const DeviceDetectionTab = ({
  screenshots,
  imageUrlPrefix,
  onRunOne,
  runningIds,
}: DeviceDetectionTabProps) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2 w-16">Thumb</th>
            <th className="px-3 py-2 w-16">ID</th>
            <th className="px-3 py-2">Participant</th>
            <th className="px-3 py-2">Device</th>
            <th className="px-3 py-2">Model</th>
            <th className="px-3 py-2 w-20">Conf</th>
            <th className="px-3 py-2 w-24">Orientation</th>
            <th className="px-3 py-2 w-16">Run</th>
          </tr>
        </thead>
        <tbody>
          {screenshots.map((s) => {
            const pp = (s.processing_metadata as any)?.preprocessing;
            const dd = pp?.device_detection;
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
                  {dd ? (
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        dd.device_category === "ipad"
                          ? "bg-blue-100 text-blue-700"
                          : dd.device_category === "iphone"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {dd.device_category}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {dd?.device_model || "—"}
                </td>
                <td className="px-3 py-2">
                  {dd ? (
                    <span
                      className={`font-mono text-xs ${
                        dd.confidence >= 0.9
                          ? "text-green-600"
                          : dd.confidence >= 0.7
                            ? "text-yellow-600"
                            : "text-red-600"
                      }`}
                    >
                      {Math.round(dd.confidence * 100)}%
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">
                  {dd?.orientation || "—"}
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
              <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                No screenshots in this group
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
