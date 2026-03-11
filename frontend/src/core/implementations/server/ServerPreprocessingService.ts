import { api } from "@/services/apiClient";
import type {
  IPreprocessingService,
  PreprocessingStage,
  RunStageOptions,
  RunStageResult,
} from "@/core/interfaces/IPreprocessingService";

/**
 * Server-mode preprocessing service.
 * Thin wrapper delegating all calls to the existing api.preprocessing / api.groups / api.screenshots methods.
 */
export class ServerPreprocessingService implements IPreprocessingService {
  async getGroups(): Promise<any[]> {
    return api.groups.list();
  }

  async getScreenshots(params: {
    group_id: string;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<{ items: any[]; total: number }> {
    return api.screenshots.list(params);
  }

  async getSummary(groupId: string): Promise<any> {
    return api.preprocessing.getSummary(groupId);
  }

  async runStage(stage: PreprocessingStage, options: RunStageOptions): Promise<RunStageResult> {
    return api.preprocessing.runStage(stage, options);
  }

  async resetStage(stage: PreprocessingStage, groupId: string): Promise<any> {
    return api.preprocessing.resetStage(stage, groupId);
  }

  async invalidateFromStage(screenshotId: number, stage: string): Promise<void> {
    await api.preprocessing.invalidateFromStage(screenshotId, stage);
  }

  async getEventLog(screenshotId: number): Promise<any> {
    return api.preprocessing.getEventLog(screenshotId);
  }

  async getScreenshot(screenshotId: number): Promise<any> {
    return api.screenshots.getById(screenshotId);
  }

  async uploadBrowser(formData: FormData): Promise<any> {
    return api.preprocessing.uploadBrowser(formData);
  }

  async getOriginalImageUrl(screenshotId: number): Promise<string> {
    return api.preprocessing.getOriginalImageUrl(screenshotId);
  }

  async applyManualCrop(
    screenshotId: number,
    crop: { left: number; top: number; right: number; bottom: number },
  ): Promise<void> {
    await api.preprocessing.applyManualCrop(screenshotId, crop);
  }

  async getPHIRegions(screenshotId: number): Promise<any> {
    return api.preprocessing.getPHIRegions(screenshotId);
  }

  async savePHIRegions(screenshotId: number, body: any): Promise<void> {
    await api.preprocessing.savePHIRegions(screenshotId, body);
  }

  async applyRedaction(screenshotId: number, body: any): Promise<void> {
    await api.preprocessing.applyRedaction(screenshotId, body);
  }

  async getDetails(screenshotId: number): Promise<any> {
    return api.preprocessing.getDetails(screenshotId);
  }
}
