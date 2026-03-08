/**
 * LoadingSpinner Component
 *
 * Lightweight, reusable spinner for loading states across the application.
 * Uses Tailwind's animate-spin utility for performance.
 */

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
  label?: string;
}

const sizeClasses = {
  small: 'h-4 w-4 border-2',
  medium: 'h-8 w-8 border-2',
  large: 'h-16 w-16 border-4',
};

export const LoadingSpinner = ({
  size = 'medium',
  className = '',
  label
}: LoadingSpinnerProps) => {
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <div
        className={`animate-spin rounded-full border-primary-600 border-t-transparent ${sizeClasses[size]} ${className}`}
        aria-hidden="true"
      />
      {label && (
        <span className="text-sm text-slate-600" aria-label={label}>
          {label}
        </span>
      )}
      <span className="sr-only">{label || 'Loading...'}</span>
    </div>
  );
};
