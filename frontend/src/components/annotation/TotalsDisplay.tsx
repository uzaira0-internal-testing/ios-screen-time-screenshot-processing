import { calculateTotalMinutes } from "@/utils/formatters";

interface TotalsDisplayProps {
  ocrTotal: string | null | undefined;
  hourlyData: Record<string, number>;
  isProcessing: boolean;
  onRecalculateOcr: () => void;
  isRecalculatingOcr: boolean;
  showRecalculateButton: boolean;
}

/**
 * Parse OCR total string (e.g., "1h 1m", "27m", "3h") to total minutes
 */
function parseOcrTotal(ocrTotal: string | null | undefined): number | null {
  if (!ocrTotal) return null;

  let totalMinutes = 0;

  // Match hours (e.g., "1h", "12h")
  const hoursMatch = ocrTotal.match(/(\d+)\s*h/i);
  if (hoursMatch && hoursMatch[1]) {
    totalMinutes += parseInt(hoursMatch[1], 10) * 60;
  }

  // Match minutes (e.g., "30m", "5m")
  const minutesMatch = ocrTotal.match(/(\d+)\s*m/i);
  if (minutesMatch && minutesMatch[1]) {
    totalMinutes += parseInt(minutesMatch[1], 10);
  }

  return totalMinutes > 0 || ocrTotal.includes("0") ? totalMinutes : null;
}

export function TotalsDisplay({
  ocrTotal,
  hourlyData,
  isProcessing,
  onRecalculateOcr,
  isRecalculatingOcr,
  showRecalculateButton,
}: TotalsDisplayProps) {
  const totalMinutes = calculateTotalMinutes(hourlyData);
  const roundedTotalMinutes = Math.round(totalMinutes); // Round for comparison
  const ocrMinutes = parseOcrTotal(ocrTotal);
  const totalsMatch = ocrMinutes !== null && ocrMinutes === roundedTotalMinutes;
  const totalsMismatch = ocrMinutes !== null && ocrMinutes !== roundedTotalMinutes;

  const highlightClass = totalsMatch
    ? "ring-2 ring-green-500 bg-green-50"
    : totalsMismatch
      ? "ring-2 ring-red-500 bg-red-50"
      : "";

  return (
    <div
      className={`border-b border-gray-100 pb-2 rounded-md p-2 ${highlightClass}`}
    >
      <div className="flex flex-col items-center text-center">
        {/* OCR Total */}
        <div className="mb-1">
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            OCR Total
            {showRecalculateButton && (
              <button
                onClick={onRecalculateOcr}
                disabled={isRecalculatingOcr}
                className="text-gray-400 hover:text-primary-600 disabled:opacity-50"
                title="Recalculate OCR total"
              >
                {isRecalculatingOcr ? (
                  <svg
                    className="w-3 h-3 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                )}
              </button>
            )}
          </div>
          <div className="text-lg font-medium text-gray-700" data-testid="ocr-total">
            {ocrTotal || "—"}
          </div>
        </div>

        {/* Bar Total */}
        <div>
          <div className="text-xs text-gray-500">Bar Total</div>
          <div
            className="text-lg font-bold text-primary-600 flex items-center justify-center gap-1"
            data-testid="bar-total"
          >
            {Math.floor(totalMinutes / 60) > 0 &&
              `${Math.floor(totalMinutes / 60)}h `}
            {Math.round(totalMinutes % 60)}m
            {isProcessing && (
              <div
                className="animate-spin h-3 w-3 border-2 border-primary-600 border-t-transparent rounded-full"
                data-testid="processing-indicator"
              ></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
