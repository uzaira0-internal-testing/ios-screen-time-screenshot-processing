/**
 * Shared constants for processing statuses
 * These must match the backend ProcessingStatus enum values
 */

export const PROCESSING_STATUSES = ['pending', 'completed', 'failed', 'skipped'] as const;

export type ProcessingStatus = typeof PROCESSING_STATUSES[number];

/**
 * Human-readable labels for processing statuses
 */
export const PROCESSING_STATUS_LABELS: Record<ProcessingStatus, string> = {
  pending: 'Pending',
  completed: 'Preprocessed',
  failed: 'Failed',
  skipped: 'Skipped',
};

/**
 * Colors for processing status badges
 */
export const PROCESSING_STATUS_COLORS: Record<ProcessingStatus, string> = {
  pending: 'text-primary-600 bg-primary-50',
  completed: 'text-green-600 bg-green-50',
  failed: 'text-red-600 bg-red-50',
  skipped: 'text-slate-600 bg-slate-100',
};
