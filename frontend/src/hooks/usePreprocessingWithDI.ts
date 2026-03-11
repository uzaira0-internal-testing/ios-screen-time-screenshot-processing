import { createContext, useContext, useMemo, useEffect, useRef, createElement, type ReactNode } from "react";
import { usePreprocessingPipelineService } from "@/core";
import { createPreprocessingStore, type PreprocessingState } from "@/store/preprocessingStore";
import { config } from "@/config";

type PreprocessingStore = ReturnType<typeof createPreprocessingStore>;

// Store instances cached by service identity, with reference counting
interface StoreEntry {
  store: PreprocessingStore;
  refCount: number;
}
const storeInstances = new Map<string, StoreEntry>();

const CLEANUP_DELAY_MS = 5000;

const PreprocessingStoreContext = createContext<PreprocessingStore | null>(null);

/**
 * Provider that creates a preprocessing store backed by the DI-resolved service.
 * Wrap PreprocessingPage (or any subtree that needs preprocessing state) with this.
 */
export function PreprocessingProvider({ children }: { children: ReactNode }) {
  const service = usePreprocessingPipelineService();
  const cacheKeyRef = useRef<string | null>(null);

  const store = useMemo(() => {
    // Use a stable key — in practice there's one preprocessing service per mode
    const cacheKey = "preprocessing";
    cacheKeyRef.current = cacheKey;

    const existing = storeInstances.get(cacheKey);
    if (existing) {
      existing.refCount++;
      return existing.store;
    }

    const newStore = createPreprocessingStore(service);
    storeInstances.set(cacheKey, { store: newStore, refCount: 1 });
    return newStore;
  }, [service]);

  // Cleanup on unmount
  useEffect(() => {
    const currentKey = cacheKeyRef.current;
    return () => {
      if (!currentKey) return;
      setTimeout(() => {
        const entry = storeInstances.get(currentKey);
        if (entry) {
          entry.refCount--;
          if (entry.refCount <= 0) {
            storeInstances.delete(currentKey);
            if (config.isDev) {
              console.log(`[PreprocessingProvider] Cleaned up store for key: ${currentKey}`);
            }
          }
        }
      }, CLEANUP_DELAY_MS);
    };
  }, []);

  return createElement(PreprocessingStoreContext.Provider, { value: store }, children);
}

/**
 * Drop-in replacement for the old `usePreprocessingStore` import.
 * Supports the same selector pattern: `usePreprocessingStore((s) => s.field)`
 */
export function usePreprocessingStore(): PreprocessingStore;
export function usePreprocessingStore<T>(selector: (state: PreprocessingState) => T): T;
export function usePreprocessingStore<T>(selector?: (state: PreprocessingState) => T) {
  const store = useContext(PreprocessingStoreContext);
  if (!store) {
    throw new Error("usePreprocessingStore must be used within a <PreprocessingProvider>");
  }
  if (selector) {
    return store(selector);
  }
  return store;
}
