// Server mode service tokens (WASM tokens archived)
export const TOKENS = {
  SCREENSHOT_SERVICE: "IScreenshotService",
  ANNOTATION_SERVICE: "IAnnotationService",
  CONSENSUS_SERVICE: "IConsensusService",
  STORAGE_SERVICE: "IStorageService",
} as const;

export type ServiceToken = (typeof TOKENS)[keyof typeof TOKENS];
