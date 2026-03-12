import { Link } from "react-router";

interface PreprocessingData {
  device_detection?: {
    device_category?: string;
    device_model?: string;
    confidence: number;
  };
  cropping?: { was_cropped?: boolean };
  phi_detection?: {
    phi_detected?: boolean;
    regions_count?: number;
  };
  phi_redaction?: {
    redacted?: boolean;
    regions_redacted?: number;
    method?: string;
  };
}

interface PreprocessingSummaryProps {
  processingMetadata?: Record<string, unknown> | null | undefined;
  screenshotId?: number;
}

function preprocessingLink(screenshotId: number, stage: string) {
  return `/preprocessing?screenshot_id=${screenshotId}&stage=${stage}&returnUrl=${encodeURIComponent(`/annotate/${screenshotId}`)}`;
}

export const PreprocessingSummary = ({
  processingMetadata,
  screenshotId,
}: PreprocessingSummaryProps) => {
  const preprocessing = processingMetadata?.preprocessing as PreprocessingData | undefined;
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
          screenshotId ? (
            <Link
              to={preprocessingLink(screenshotId, pd.phi_detected ? "phi_redaction" : "phi_detection")}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium hover:ring-2 hover:ring-offset-1 transition-all ${
                pd.phi_detected
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:ring-red-300"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:ring-green-300"
              }`}
              title={
                pd.phi_detected
                  ? `PHI detected: ${pd.regions_count} region(s) — click to edit`
                  : "No PHI detected — click to review"
              }
            >
              {pd.phi_detected ? `PHI: ${pd.regions_count}` : "No PHI"}
              <span className="opacity-60">&#8594;</span>
            </Link>
          ) : (
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
          )
        )}
        {pr?.redacted && (
          screenshotId ? (
            <Link
              to={preprocessingLink(screenshotId, "phi_redaction")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 hover:ring-2 hover:ring-orange-300 hover:ring-offset-1 transition-all"
              title={`${pr.regions_redacted} region(s) redacted via ${pr.method} — click to edit`}
            >
              Redacted <span className="opacity-60">&#8594;</span>
            </Link>
          ) : (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
              title={`${pr.regions_redacted} region(s) redacted via ${pr.method}`}
            >
              Redacted
            </span>
          )
        )}
      </div>
    </div>
  );
};
