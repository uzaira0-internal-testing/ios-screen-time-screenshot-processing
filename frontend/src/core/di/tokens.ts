export const TOKENS = {
  SCREENSHOT_SERVICE: "IScreenshotService",
  ANNOTATION_SERVICE: "IAnnotationService",
  CONSENSUS_SERVICE: "IConsensusService",
  STORAGE_SERVICE: "IStorageService",
  PROCESSING_SERVICE: "IProcessingService",
} as const;

export type ServiceToken = (typeof TOKENS)[keyof typeof TOKENS];
