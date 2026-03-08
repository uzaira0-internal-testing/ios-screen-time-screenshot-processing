import { useState } from 'react';
import { useScreenshotImage } from '@/hooks/useScreenshotImage';

interface ImageViewerProps {
  screenshotId: number;
  alt?: string;
}

export const ImageViewer = ({ screenshotId, alt = 'Screenshot' }: ImageViewerProps) => {
  const [error, setError] = useState(false);
  const imageUrl = useScreenshotImage(screenshotId);

  return (
    <div className="bg-slate-800 rounded-lg overflow-hidden">
      {!imageUrl ? (
        <div className="flex items-center justify-center h-96 text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-sm text-slate-400">Loading image...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-96 text-white">
          <div className="text-center">
            <p className="text-lg font-medium">Failed to load image</p>
            <p className="text-sm text-slate-400 mt-2">Please try refreshing the page</p>
          </div>
        </div>
      ) : (
        <img
          src={imageUrl}
          alt={alt}
          onError={() => setError(true)}
          className="w-full h-auto max-h-[600px] object-contain"
        />
      )}
    </div>
  );
};
