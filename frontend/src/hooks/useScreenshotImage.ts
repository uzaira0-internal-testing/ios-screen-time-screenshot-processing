import { useEffect, useState } from "react";
import { useScreenshotService } from "@/core/hooks/useServices";

/**
 * Hook to get the image URL for a screenshot, handling both server and WASM modes
 */
export function useScreenshotImage(screenshotId: number): string | null {
  const screenshotService = useScreenshotService();
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    // Don't try to load if screenshotId is 0 or invalid
    if (!screenshotId) {
      setImageUrl(null);
      return;
    }

    let cancelled = false;

    const loadImage = async () => {
      try {
        const resolvedUrl = await screenshotService.getImageUrl(screenshotId);
        if (!cancelled) {
          setImageUrl(resolvedUrl);
        }
        // Note: blob URLs are managed by the opfsBlobStorage LRU cache.
        // Do NOT revoke them here — the cache shares URLs across components
        // and revokes them automatically on eviction.
      } catch (error) {
        if (!cancelled) {
          console.error(
            `Failed to load image for screenshot ${screenshotId}:`,
            error,
          );
          setImageUrl(null);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [screenshotId, screenshotService]);

  return imageUrl;
}
