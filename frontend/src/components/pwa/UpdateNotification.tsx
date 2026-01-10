import React from 'react';
import toast from 'react-hot-toast';

interface UpdateNotificationProps {
  onUpdate: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({ onUpdate }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <svg
          className="w-5 h-5 text-blue-500"
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
        <span className="font-medium">New version available!</span>
      </div>
      <p className="text-sm text-gray-600">
        A new version of the app is ready. Update now for the latest features and improvements.
      </p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={onUpdate}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm font-medium"
        >
          Update Now
        </button>
        <button
          onClick={() => toast.dismiss()}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors text-sm font-medium"
        >
          Later
        </button>
      </div>
    </div>
  );
};

export const showUpdateNotification = (onUpdate: () => void) => {
  toast.custom(
    (t) => (
      <div
        className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-md w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
      >
        <div className="flex-1 w-0 p-4">
          <UpdateNotification onUpdate={onUpdate} />
        </div>
      </div>
    ),
    {
      duration: Infinity,
      position: 'top-center',
    }
  );
};
