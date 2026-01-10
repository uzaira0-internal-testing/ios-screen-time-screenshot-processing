/**
 * InitializationScreen Component
 *
 * Full-screen loading screen shown during app initialization.
 * Specifically for preloading Tesseract.js on first app load (WASM mode only).
 */

import { LoadingSpinner } from './LoadingSpinner';

interface InitializationScreenProps {
  progress: number; // 0-100
  error?: string | null;
}

export const InitializationScreen = ({
  progress,
  error,
}: InitializationScreenProps) => {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        {/* Logo/Branding Area */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">📸</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            iOS Screen Time
          </h1>
          <p className="text-gray-600">Preparing your workspace...</p>
        </div>

        {/* Progress Card */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          {error ? (
            // Error State
            <div className="text-center">
              <div className="text-4xl mb-4">⚠️</div>
              <h2 className="text-xl font-semibold text-red-600 mb-2">
                Initialization Failed
              </h2>
              <p className="text-sm text-gray-600 mb-4">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
            // Loading State
            <>
              <div className="flex items-center justify-center mb-4">
                <LoadingSpinner size="large" />
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    Loading OCR Engine
                  </span>
                  <span className="text-sm font-semibold text-primary-600">
                    {Math.round(progress)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-primary-500 to-primary-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    role="progressbar"
                    aria-valuenow={Math.round(progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Initialization progress"
                  />
                </div>
              </div>

              {/* Info Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">
                  First-Time Setup
                </h3>
                <p className="text-xs text-blue-800 leading-relaxed">
                  We're loading the OCR engine and language data (about 5MB).
                  This only happens once and will be cached for future visits.
                  Future processing will be much faster!
                </p>
              </div>

              {/* Stage Messages */}
              <div className="mt-4 text-center">
                <p className="text-sm text-gray-600">
                  {progress < 30
                    ? 'Downloading Tesseract.js core...'
                    : progress < 70
                    ? 'Loading language data...'
                    : progress < 95
                    ? 'Initializing OCR engine...'
                    : 'Almost ready...'}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-sm text-gray-600">
            Processing happens 100% in your browser
          </p>
          <p className="text-xs text-gray-500 mt-1">
            No data is sent to any server
          </p>
        </div>
      </div>
    </div>
  );
};
