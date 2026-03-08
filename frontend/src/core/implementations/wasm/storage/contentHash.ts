/**
 * Content Hash Utility
 *
 * Computes SHA-256 content hashes for deduplication.
 * Used to detect duplicate images before storage.
 */

export async function computeContentHash(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
