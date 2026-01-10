/**
 * Hook for accessing dependency-injected services
 */

import { useContext } from 'react';
import { ServiceContext } from '@/core/hooks/ServiceProvider';
import { TOKENS } from '@/core/di/tokens';
import type { IScreenshotService } from '@/core/interfaces/IScreenshotService';
import type { IAnnotationService } from '@/core/interfaces/IAnnotationService';
import type { IConsensusService } from '@/core/interfaces/IConsensusService';
import type { IStorageService } from '@/core/interfaces/IStorageService';
import type { IProcessingService } from '@/core/interfaces/IProcessingService';

export interface Services {
  screenshot: IScreenshotService;
  annotation: IAnnotationService;
  consensus: IConsensusService;
  storage: IStorageService;
  processing?: IProcessingService;
  export?: any; // DataExportService (WASM only)
}

/**
 * Hook to access all injected services from the DI container
 */
export function useServices(): Services {
  const container = useContext(ServiceContext);

  if (!container) {
    throw new Error('useServices must be used within a ServiceProvider');
  }

  // Required services (available in both modes)
  const screenshot = container.resolve<IScreenshotService>(TOKENS.SCREENSHOT_SERVICE);
  const annotation = container.resolve<IAnnotationService>(TOKENS.ANNOTATION_SERVICE);
  const consensus = container.resolve<IConsensusService>(TOKENS.CONSENSUS_SERVICE);
  const storage = container.resolve<IStorageService>(TOKENS.STORAGE_SERVICE);

  // Optional services (may not exist in all modes)
  const processing = container.has(TOKENS.PROCESSING_SERVICE)
    ? container.resolve<IProcessingService>(TOKENS.PROCESSING_SERVICE)
    : undefined;

  const exportService = container.has(TOKENS.EXPORT_SERVICE)
    ? container.resolve(TOKENS.EXPORT_SERVICE)
    : undefined;

  return {
    screenshot,
    annotation,
    consensus,
    storage,
    processing,
    export: exportService,
  };
}

/**
 * Hook to access a specific service from the DI container
 */
export function useService<T>(token: string): T {
  const container = useContext(ServiceContext);

  if (!container) {
    throw new Error('useService must be used within a ServiceProvider');
  }

  return container.resolve<T>(token);
}
