/**
 * ProcessingProgress Component
 *
 * Full-screen overlay with progress bar and stage-specific messaging.
 * Used for all image processing operations to provide user feedback.
 */

import { LoadingSpinner } from './LoadingSpinner';
import type { ProcessingProgress as ProgressType } from '@/core/interfaces/IProcessingService';

interface ProcessingProgressProps {
  stage: ProgressType['stage'];
  progress: number; // 0-100
  message?: string;
  onCancel?: () => void;
  isVisible: boolean;
}

// User-friendly labels for each processing stage
const STAGE_LABELS: Record<ProgressType['stage'], string> = {
  loading: 'Initializing OCR engine',
  preprocessing: 'Detecting grid boundaries',
  ocr_title: 'Extracting title',
  ocr_total: 'Reading total usage',
  ocr_hourly: 'Processing hourly data',
  complete: 'Complete',
};

// Detailed messages for each stage
const STAGE_MESSAGES: Record<ProgressType['stage'], string> = {
  loading: 'Loading Tesseract.js and language data...',
  preprocessing: 'Analyzing image structure and detecting grid...',
  ocr_title: 'Extracting title from screenshot...',
  ocr_total: 'Reading total usage value...',
  ocr_hourly: 'Extracting hourly usage data (this may take a moment)...',
  complete: 'Processing complete!',
};

export const ProcessingProgress = ({
  stage,
  progress,
  message,
  onCancel,
  isVisible,
}: ProcessingProgressProps) => {
  if (!isVisible) return null;

  const stageLabel = STAGE_LABELS[stage];
  const defaultMessage = STAGE_MESSAGES[stage];
  const displayMessage = message || defaultMessage;

  // Calculate estimated time remaining (rough estimate)
  const estimatedSeconds = Math.max(1, Math.round((100 - progress) * 0.05));
  const showTimeEstimate = progress > 10 && progress < 95;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="processing-title"
      aria-describedby="processing-description"
    >
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2
            id="processing-title"
            className="text-2xl font-bold text-gray-900 flex items-center gap-3"
          >
            <LoadingSpinner size="medium" />
            Processing
          </h2>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Cancel processing"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Current Stage */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              {stageLabel}
            </span>
            <span className="text-sm font-semibold text-primary-600">
              {Math.round(progress)}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-primary-500 to-primary-600 h-3 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>

        {/* Stage Message */}
        <p
          id="processing-description"
          className="text-sm text-gray-600 mb-3 min-h-[2.5rem]"
        >
          {displayMessage}
        </p>

        {/* Time Estimate */}
        {showTimeEstimate && (
          <p className="text-xs text-gray-500 italic">
            About {estimatedSeconds} second{estimatedSeconds !== 1 ? 's' : ''}{' '}
            remaining...
          </p>
        )}

        {/* First-time user hint */}
        {stage === 'loading' && progress < 20 && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-800">
              <strong>First-time setup:</strong> Loading OCR engine and
              language data. This only happens once and will be cached for
              future use.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
