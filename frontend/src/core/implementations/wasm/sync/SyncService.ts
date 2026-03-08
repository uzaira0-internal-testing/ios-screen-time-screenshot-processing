import { db } from "../storage/database";
import type { SyncStatus } from "../storage/database/ScreenshotDB";
import { retrieveImageBlob } from "../storage/opfsBlobStorage";

export interface SyncConfig {
  serverUrl: string;
  username: string;
}

export interface SyncProgress {
  phase: "push" | "pull";
  current: number;
  total: number;
  entity: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export class SyncService {
  private config: SyncConfig | null = null;
  private abortController: AbortController | null = null;

  configure(config: SyncConfig): void {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config !== null && !!this.config.serverUrl;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async checkServerHealth(): Promise<boolean> {
    if (!this.config) return false;
    try {
      const res = await fetch(`${this.config.serverUrl}/auth/me`, {
        headers: { "X-Username": this.config.username },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sync(onProgress?: SyncProgressCallback): Promise<{
    pushed: { screenshots: number; annotations: number };
    pulled: { annotations: number };
    errors: string[];
  }> {
    if (!this.config) {
      throw new Error("SyncService not configured. Call configure() first.");
    }

    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const errors: string[] = [];
    const result = {
      pushed: { screenshots: 0, annotations: 0 },
      pulled: { annotations: 0 },
      errors,
    };

    await this.pushScreenshots(result, errors, signal, onProgress);
    await this.pushAnnotations(result, errors, signal, onProgress);
    await this.pullConsensus(result, errors, signal, onProgress);

    this.abortController = null;
    return result;
  }

  private async pushScreenshots(
    result: { pushed: { screenshots: number; annotations: number } },
    errors: string[],
    signal: AbortSignal,
    onProgress?: SyncProgressCallback,
  ): Promise<void> {
    if (!this.config) return;
    const apiConfig = this.config;

    const allScreenshots = await db.screenshots.toArray();
    const syncRecords = await db.syncRecords
      .where("entity_type")
      .equals("screenshot")
      .toArray();
    const syncedLocalIds = new Set(syncRecords.map((r) => r.localId));
    const unsyncedScreenshots = allScreenshots.filter(
      (s) => s.id !== undefined && !syncedLocalIds.has(s.id!),
    );

    for (let i = 0; i < unsyncedScreenshots.length; i++) {
      if (signal.aborted) return;

      const screenshot = unsyncedScreenshots[i]!;
      const screenshotId = screenshot.id!;

      onProgress?.({
        phase: "push",
        current: i + 1,
        total: unsyncedScreenshots.length,
        entity: `screenshot #${screenshotId}`,
      });

      try {
        const blob = await retrieveImageBlob(screenshotId);
        if (!blob) {
          errors.push(`No image blob for screenshot ${screenshotId}`);
          continue;
        }

        const formData = new FormData();
        formData.append("file", blob, `screenshot-${screenshotId}.png`);
        formData.append(
          "image_type",
          screenshot.image_type || "screen_time",
        );

        const res = await fetch(
          `${apiConfig.serverUrl}/screenshots/upload/browser`,
          {
            method: "POST",
            headers: { "X-Username": apiConfig.username },
            body: formData,
            signal,
          },
        );

        if (!res.ok) {
          errors.push(
            `Failed to push screenshot ${screenshotId}: ${res.status}`,
          );
          continue;
        }

        const serverScreenshot = await res.json();

        await db.syncRecords.add({
          entity_type: "screenshot",
          localId: screenshotId,
          serverId: serverScreenshot.id,
          sync_status: "synced" as SyncStatus,
          syncedAt: new Date().toISOString(),
        });

        result.pushed.screenshots++;
      } catch (err) {
        if (signal.aborted) return;
        errors.push(
          `Error pushing screenshot ${screenshotId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async pushAnnotations(
    result: { pushed: { screenshots: number; annotations: number } },
    errors: string[],
    signal: AbortSignal,
    onProgress?: SyncProgressCallback,
  ): Promise<void> {
    if (!this.config) return;
    const apiConfig = this.config;

    const allAnnotations = await db.annotations.toArray();
    const annotationSyncRecords = await db.syncRecords
      .where("entity_type")
      .equals("annotation")
      .toArray();
    const syncedAnnotationIds = new Set(
      annotationSyncRecords.map((r) => r.localId),
    );
    const unsyncedAnnotations = allAnnotations.filter(
      (a) => a.id !== undefined && !syncedAnnotationIds.has(a.id!),
    );

    const screenshotSyncRecords = await db.syncRecords
      .where("entity_type")
      .equals("screenshot")
      .toArray();
    const localToServerScreenshot = new Map(
      screenshotSyncRecords.map((r) => [r.localId, r.serverId]),
    );

    for (let i = 0; i < unsyncedAnnotations.length; i++) {
      if (signal.aborted) return;

      const annotation = unsyncedAnnotations[i]!;
      const annotationId = annotation.id!;

      onProgress?.({
        phase: "push",
        current: i + 1,
        total: unsyncedAnnotations.length,
        entity: `annotation #${annotationId}`,
      });

      const serverScreenshotId = localToServerScreenshot.get(
        annotation.screenshot_id,
      );
      if (!serverScreenshotId) {
        errors.push(
          `Annotation ${annotationId}: parent screenshot ${annotation.screenshot_id} not synced`,
        );
        continue;
      }

      try {
        const res = await fetch(`${apiConfig.serverUrl}/annotations/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Username": apiConfig.username,
          },
          body: JSON.stringify({
            screenshot_id: serverScreenshotId,
            hourly_values: annotation.hourly_values,
          }),
          signal,
        });

        if (!res.ok) {
          errors.push(
            `Failed to push annotation ${annotationId}: ${res.status}`,
          );
          continue;
        }

        const serverAnnotation = await res.json();

        await db.syncRecords.add({
          entity_type: "annotation",
          localId: annotationId,
          serverId: serverAnnotation.id,
          sync_status: "synced" as SyncStatus,
          syncedAt: new Date().toISOString(),
        });

        result.pushed.annotations++;
      } catch (err) {
        if (signal.aborted) return;
        errors.push(
          `Error pushing annotation ${annotationId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async pullConsensus(
    result: { pulled: { annotations: number } },
    errors: string[],
    signal: AbortSignal,
    onProgress?: SyncProgressCallback,
  ): Promise<void> {
    if (!this.config) return;
    const apiConfig = this.config;

    const screenshotSyncRecords = await db.syncRecords
      .where("entity_type")
      .equals("screenshot")
      .toArray();

    for (let i = 0; i < screenshotSyncRecords.length; i++) {
      if (signal.aborted) return;

      const record = screenshotSyncRecords[i]!;
      if (!record.serverId) continue;

      onProgress?.({
        phase: "pull",
        current: i + 1,
        total: screenshotSyncRecords.length,
        entity: `consensus for screenshot #${record.localId}`,
      });

      try {
        const res = await fetch(
          `${apiConfig.serverUrl}/consensus/${record.serverId}`,
          {
            headers: { "X-Username": apiConfig.username },
            signal,
          },
        );

        if (!res.ok) continue;

        const consensus = await res.json();
        if (consensus.annotations) {
          for (const annotation of consensus.annotations) {
            await db.annotations.put({
              ...annotation,
              screenshot_id: record.localId,
              sync_status: "remote",
            });
          }
          result.pulled.annotations += consensus.annotations.length;
        }
      } catch (err) {
        if (signal.aborted) return;
        errors.push(
          `Error pulling consensus for screenshot ${record.localId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async getPendingCounts(): Promise<{
    pendingUploads: number;
    pendingDownloads: number;
  }> {
    const allScreenshots = await db.screenshots.count();
    const syncedScreenshots = await db.syncRecords
      .where("entity_type")
      .equals("screenshot")
      .count();

    const allAnnotations = await db.annotations.count();
    const syncedAnnotations = await db.syncRecords
      .where("entity_type")
      .equals("annotation")
      .count();

    return {
      pendingUploads:
        allScreenshots - syncedScreenshots + (allAnnotations - syncedAnnotations),
      pendingDownloads: 0,
    };
  }
}

export const syncService = new SyncService();
