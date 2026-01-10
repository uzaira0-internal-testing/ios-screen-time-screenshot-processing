import { useEffect, useState } from "react";
import { useScreenshotService } from "@/core/hooks/useServices";
import { config } from "@/config";

/**
 * Hook to get the image URL for a screenshot, handling both server and WASM modes
 */
export function useScreenshotImage(screenshotId: number): string | null {
  const screenshotService = useScreenshotService();
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (config.isDev) {
      console.log(
        `[useScreenshotImage] Effect triggered, screenshotId:`,
        screenshotId,
      );
    }

    // Don't try to load if screenshotId is 0 or invalid
    if (!screenshotId) {
      if (config.isDev) {
        console.log(`[useScreenshotImage] Invalid screenshotId, clearing URL`);
      }
      setImageUrl(null);
      return;
    }

    let cleanup: (() => void) | undefined;

    const loadImage = async () => {
      try {
        if (config.isDev) {
          console.log(
            `[useScreenshotImage] Loading image for screenshot ${screenshotId}...`,
          );
        }
        // getImageUrl always returns Promise<string> now
        const resolvedUrl = await screenshotService.getImageUrl(screenshotId);
        if (config.isDev) {
          console.log(`[useScreenshotImage] Resolved URL:`, resolvedUrl);
        }
        setImageUrl(resolvedUrl);

        // If it's a blob URL, set up cleanup
        if (resolvedUrl.startsWith("blob:")) {
          cleanup = () => URL.revokeObjectURL(resolvedUrl);
        }
      } catch (error) {
        console.error(
          `Failed to load image for screenshot ${screenshotId}:`,
          error,
        );
        setImageUrl(null);
      }
    };

    loadImage();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [screenshotId, screenshotService]);

  return imageUrl;
}
