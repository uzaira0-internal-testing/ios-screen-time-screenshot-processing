import { useContext } from "react";
import { ServiceContext } from "./ServiceProvider";
import { TOKENS } from "../di";
import type {
  IScreenshotService,
  IAnnotationService,
  IConsensusService,
  IStorageService,
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

// WASM-only services have been archived
export function useProcessingService(): null {
  return null;
}

export function usePrefetchService(): null {
  return null;
}
