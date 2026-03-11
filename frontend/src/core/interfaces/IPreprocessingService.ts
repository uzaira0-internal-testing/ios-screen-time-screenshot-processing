export type PreprocessingStage = "device_detection" | "cropping" | "phi_detection" | "phi_redaction";

export interface RunStageOptions {
  group_id?: string;
  screenshot_ids?: number[];
  phi_pipeline_preset?: string;
  phi_redaction_method?: string;
  llm_endpoint?: string;
  llm_model?: string;
}

export interface RunStageResult {
  queued_count: number;
  message: string;
  screenshot_ids?: number[];
}

export interface IPreprocessingService {
  getGroups(): Promise<any[]>;
  getScreenshots(params: {
    group_id: string;
    page_size?: number;
    sort_by?: string;
    sort_order?: string;
  }): Promise<{ items: any[]; total: number }>;
  getSummary(groupId: string): Promise<any>;
  runStage(stage: PreprocessingStage, options: RunStageOptions): Promise<RunStageResult>;
  resetStage(stage: PreprocessingStage, groupId: string): Promise<any>;
  invalidateFromStage(screenshotId: number, stage: string): Promise<void>;
  getEventLog(screenshotId: number): Promise<any>;
  getScreenshot(screenshotId: number): Promise<any>;
  uploadBrowser(formData: FormData): Promise<any>;
  getOriginalImageUrl(screenshotId: number): Promise<string>;
  applyManualCrop(screenshotId: number, crop: { left: number; top: number; right: number; bottom: number }): Promise<void>;
  getPHIRegions(screenshotId: number): Promise<any>;
  savePHIRegions(screenshotId: number, body: any): Promise<void>;
  applyRedaction(screenshotId: number, body: any): Promise<void>;
  getDetails(screenshotId: number): Promise<any>;
}
