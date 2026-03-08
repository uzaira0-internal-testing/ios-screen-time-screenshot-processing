/**
 * OPFS (Origin Private File System) Blob Storage
 *
 * Primary storage for image blobs. Falls back to IndexedDB blob table
 * if OPFS is unavailable (older browsers without OPFS support).
 *
 * Also provides utility functions for storage quota management,
 * image compression, and blob info retrieval.
 */

import { db } from "./database";

let opfsRoot: FileSystemDirectoryHandle | null = null;
let opfsAvailable: boolean | null = null;

// LRU cache for object URLs with automatic eviction
const MAX_CACHE_SIZE = 50;
const urlCache = new Map<number, string>();
const cacheAccessOrder: number[] = [];

/**
 * Evict oldest entries from cache if over limit
 */
function evictOldEntries(): void {
  while (cacheAccessOrder.length > MAX_CACHE_SIZE) {
    const oldestId = cacheAccessOrder.shift();
    if (oldestId !== undefined) {
      const url = urlCache.get(oldestId);
      if (url) {
        URL.revokeObjectURL(url);
        urlCache.delete(oldestId);
      }
    }
  }
}

/**
 * Update LRU access order
 */
function touchCache(id: number): void {
  const index = cacheAccessOrder.indexOf(id);
  if (index > -1) {
    cacheAccessOrder.splice(index, 1);
  }
  cacheAccessOrder.push(id);
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (opfsAvailable === false) return null;
  if (opfsRoot) return opfsRoot;

  try {
    const root = await navigator.storage.getDirectory();
    opfsRoot = await root.getDirectoryHandle("screenshots", { create: true });
    opfsAvailable = true;
    return opfsRoot;
  } catch (error) {
    console.warn(
      "[opfsBlobStorage] OPFS unavailable, falling back to IndexedDB:",
      error instanceof Error ? error.message : error,
    );
    opfsAvailable = false;
    return null;
  }
}

export async function storeImageBlob(id: number, blob: Blob): Promise<void> {
  const root = await getOpfsRoot();
  if (root) {
    const fileHandle = await root.getFileHandle(`${id}.img`, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } catch (error) {
      try { await writable.close(); } catch { /* prevent stream lock */ }
      throw new Error(
        `Failed to write image blob for screenshot ${id}: ${error instanceof Error ? error.message : error}`,
      );
    }
    await writable.close();
  } else {
    // IndexedDB fallback
    await db.imageBlobs.put({ screenshotId: id, blob, uploadedAt: new Date() });
  }
}

export async function retrieveImageBlob(id: number): Promise<Blob | null> {
  const root = await getOpfsRoot();
  if (root) {
    try {
      const fileHandle = await root.getFileHandle(`${id}.img`);
      const file = await fileHandle.getFile();
      return file;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return null;
      }
      console.error(`[opfsBlobStorage] Error retrieving blob for screenshot ${id}:`, error);
      return null;
    }
  } else {
    const entry = await db.imageBlobs.get(id);
    return entry?.blob ?? null;
  }
}

export async function deleteImageBlob(id: number): Promise<void> {
  // Revoke any cached URL
  revokeObjectURL(id);

  const root = await getOpfsRoot();
  if (root) {
    try {
      await root.removeEntry(`${id}.img`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        console.warn(`[opfsBlobStorage] Failed to delete blob for screenshot ${id}:`, error);
      }
    }
  } else {
    await db.imageBlobs.delete(id);
  }
}

/**
 * Create an object URL for a screenshot image.
 *
 * If a blob is provided, it is used directly. Otherwise the blob is
 * retrieved from storage. Returns null when no blob can be found.
 */
export async function createObjectURL(
  id: number,
  blob?: Blob,
): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) {
    touchCache(id);
    return cached;
  }

  const resolvedBlob = blob ?? (await retrieveImageBlob(id));
  if (!resolvedBlob) {
    return null;
  }

  const url = URL.createObjectURL(resolvedBlob);
  urlCache.set(id, url);
  touchCache(id);

  // Evict old entries if cache is too large
  evictOldEntries();

  return url;
}

export function revokeObjectURL(id: number): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
    const index = cacheAccessOrder.indexOf(id);
    if (index > -1) {
      cacheAccessOrder.splice(index, 1);
    }
  }
}

export function revokeAllObjectURLs(): void {
  for (const url of urlCache.values()) {
    URL.revokeObjectURL(url);
  }
  urlCache.clear();
  cacheAccessOrder.length = 0;
}

// ---------------------------------------------------------------------------
// Utility functions for storage quota, blob info, and image compression
// ---------------------------------------------------------------------------

export async function getImageBlobInfo(screenshotId: number): Promise<{
  size: number;
  type: string;
  uploadedAt: string;
} | null> {
  const blob = await retrieveImageBlob(screenshotId);
  if (!blob) {
    return null;
  }

  return {
    size: blob.size,
    type: blob.type,
    // OPFS doesn't store uploadedAt metadata; approximate with current time
    uploadedAt: "",
  };
}

export async function getTotalBlobSize(): Promise<number> {
  const root = await getOpfsRoot();
  if (root) {
    let total = 0;
    try {
      for await (const [, handle] of root as unknown as AsyncIterable<
        [string, FileSystemHandle]
      >) {
        if (handle.kind === "file") {
          const file = await (handle as FileSystemFileHandle).getFile();
          total += file.size;
        }
      }
    } catch (error) {
      console.error("[opfsBlobStorage] Error calculating total blob size:", error);
    }
    return total;
  } else {
    const allBlobs = await db.imageBlobs.toArray();
    return allBlobs.reduce((total, record) => total + record.blob.size, 0);
  }
}

export async function checkStorageQuota(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
  available: number;
}> {
  if (!navigator.storage || !navigator.storage.estimate) {
    console.warn("[opfsBlobStorage] Storage estimation API unavailable");
    return {
      usage: 0,
      quota: Infinity,
      percentUsed: 0,
      available: Infinity,
    };
  }

  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage || 0;
  const quota = estimate.quota || 0;
  const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
  const available = quota - usage;

  return {
    usage,
    quota,
    percentUsed,
    available,
  };
}

export async function canStoreBlob(blob: Blob): Promise<boolean> {
  const quota = await checkStorageQuota();
  const blobSize = blob.size;

  const SAFETY_MARGIN = 10 * 1024 * 1024;

  return quota.available > blobSize + SAFETY_MARGIN;
}

export async function compressImage(
  blob: Blob,
  maxWidth = 1920,
  quality = 0.9,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    // Track the temporary blob URL so we can revoke it when done
    const tempUrl = URL.createObjectURL(blob);

    img.onload = () => {
      // Revoke the temporary URL now that the image has loaded
      URL.revokeObjectURL(tempUrl);

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (compressedBlob) => {
          if (compressedBlob) {
            resolve(compressedBlob);
          } else {
            reject(new Error("Failed to compress image"));
          }
        },
        "image/jpeg",
        quality,
      );
    };

    img.onerror = () => {
      // Revoke the temporary URL on error as well
      URL.revokeObjectURL(tempUrl);
      reject(new Error("Failed to load image for compression"));
    };

    img.src = tempUrl;
  });
}
