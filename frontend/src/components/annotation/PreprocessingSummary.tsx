interface PreprocessingSummaryProps {
  processingMetadata?: Record<string, unknown> | null;
}

export const PreprocessingSummary = ({
  processingMetadata,
}: PreprocessingSummaryProps) => {
  const preprocessing = (processingMetadata as any)?.preprocessing;
  if (!preprocessing) return null;

  const dd = preprocessing.device_detection;
  const cr = preprocessing.cropping;
  const pd = preprocessing.phi_detection;
  const pr = preprocessing.phi_redaction;

  return (
    <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
      <div className="text-xs text-slate-500 mb-1">Preprocessing</div>
      <div className="flex flex-wrap gap-1.5">
        {dd && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              dd.device_category === "ipad"
                ? "bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400"
                : dd.device_category === "iphone"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
            }`}
            title={`Device: ${dd.device_model || dd.device_category} (${Math.round(dd.confidence * 100)}%)`}
          >
            {dd.device_category}
          </span>
        )}
        {cr?.was_cropped && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
            title="iPad sidebar was cropped"
          >
            Cropped
          </span>
        )}
        {pd && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              pd.phi_detected
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            }`}
            title={
              pd.phi_detected
                ? `PHI detected: ${pd.regions_count} region(s)`
                : "No PHI detected"
            }
          >
            {pd.phi_detected ? `PHI: ${pd.regions_count}` : "No PHI"}
          </span>
        )}
        {pr?.redacted && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
            title={`${pr.regions_redacted} region(s) redacted via ${pr.method}`}
          >
            Redacted
          </span>
        )}
      </div>
    </div>
  );
};
