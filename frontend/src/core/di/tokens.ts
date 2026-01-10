export const TOKENS = {
  SCREENSHOT_SERVICE: "IScreenshotService",
  ANNOTATION_SERVICE: "IAnnotationService",
  CONSENSUS_SERVICE: "IConsensusService",
  STORAGE_SERVICE: "IStorageService",
  PROCESSING_SERVICE: "IProcessingService",
  EXPORT_SERVICE: "IExportService",
  PREFETCH_SERVICE: "IPrefetchService",
} as const;

export type ServiceToken = (typeof TOKENS)[keyof typeof TOKENS];
