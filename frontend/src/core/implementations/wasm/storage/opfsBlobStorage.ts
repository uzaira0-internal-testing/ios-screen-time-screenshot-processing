/**
 * OPFS (Origin Private File System) Blob Storage
 *
 * Primary storage for image blobs. Falls back to IndexedDB blob table
 * if OPFS is unavailable (Safari < 15.2).
 */

import { db } from "./database";

let opfsRoot: FileSystemDirectoryHandle | null = null;
let opfsAvailable: boolean | null = null;

const urlCache = new Map<number, string>();
const MAX_CACHE_SIZE = 50;

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (opfsAvailable === false) return null;
  if (opfsRoot) return opfsRoot;

  try {
    opfsRoot = await navigator.storage.getDirectory();
    const screenshotsDir = await opfsRoot.getDirectoryHandle("screenshots", { create: true });
    opfsAvailable = true;
    return screenshotsDir;
  } catch {
    opfsAvailable = false;
    return null;
  }
}

export async function storeImageBlob(id: number, blob: Blob): Promise<void> {
  const root = await getOpfsRoot();
  if (root) {
    const fileHandle = await root.getFileHandle(`${id}.img`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
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
    } catch {
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
    } catch {
      // File may not exist
    }
  } else {
    await db.imageBlobs.delete(id);
  }
}

export function createObjectURL(id: number, blob: Blob): string {
  const cached = urlCache.get(id);
  if (cached) return cached;

  // Evict oldest if cache full
  if (urlCache.size >= MAX_CACHE_SIZE) {
    const firstKey = urlCache.keys().next().value;
    if (firstKey !== undefined) {
      const firstUrl = urlCache.get(firstKey);
      if (firstUrl) URL.revokeObjectURL(firstUrl);
      urlCache.delete(firstKey);
    }
  }

  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function revokeObjectURL(id: number): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

export function revokeAllObjectURLs(): void {
  for (const url of urlCache.values()) {
    URL.revokeObjectURL(url);
  }
  urlCache.clear();
}
