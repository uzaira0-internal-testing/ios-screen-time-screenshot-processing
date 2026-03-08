import { useContext } from "react";
import { ServiceContext } from "./ServiceProvider";
import { TOKENS } from "../di";
import type {
  IScreenshotService,
  IAnnotationService,
  IConsensusService,
  IStorageService,
  IProcessingService,
} from "../interfaces";

function useServiceContainer() {
  const container = useContext(ServiceContext);

  if (!container) {
    throw new Error(
      "useServiceContainer must be used within a ServiceProvider",
    );
  }

  return container;
}

export function useScreenshotService(): IScreenshotService {
  const container = useServiceContainer();
  return container.resolve<IScreenshotService>(TOKENS.SCREENSHOT_SERVICE);
}

export function useAnnotationService(): IAnnotationService {
  const container = useServiceContainer();
  return container.resolve<IAnnotationService>(TOKENS.ANNOTATION_SERVICE);
}

export function useConsensusService(): IConsensusService {
  const container = useServiceContainer();
  return container.resolve<IConsensusService>(TOKENS.CONSENSUS_SERVICE);
}

export function useStorageService(): IStorageService {
  const container = useServiceContainer();
  return container.resolve<IStorageService>(TOKENS.STORAGE_SERVICE);
}

/**
 * Returns the processing service if registered (WASM mode), or null (server mode).
 */
export function useProcessingService(): IProcessingService | null {
  const container = useServiceContainer();
  if (container.has(TOKENS.PROCESSING_SERVICE)) {
    return container.resolve<IProcessingService>(TOKENS.PROCESSING_SERVICE);
  }
  return null;
}
