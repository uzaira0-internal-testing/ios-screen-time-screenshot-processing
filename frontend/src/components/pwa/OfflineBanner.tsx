import React, { useEffect, useState } from 'react';

export const OfflineBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setWasOffline(true);
      setTimeout(() => setWasOffline(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !wasOffline) {
    return null;
  }

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 px-4 py-3 text-center text-sm font-medium transition-all ${
        isOnline
          ? 'bg-green-500 text-white'
          : 'bg-yellow-500 text-gray-900'
      }`}
      role="alert"
      aria-live="polite"
    >
      {isOnline ? (
        <div className="flex items-center justify-center gap-2">
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>Back online! Your data will sync automatically.</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2">
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            You're offline. App works in local mode - your data stays on this device.
          </span>
        </div>
      )}
    </div>
  );
};
