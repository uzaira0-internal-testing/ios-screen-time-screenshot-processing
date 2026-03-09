import React, {
  createContext,
  useRef,
  useEffect,
  type ReactNode,
  useState,
} from "react";
import { ServiceContainer, bootstrapServices } from "../di";
import { createConfig, AppConfig } from "../config";
import { config as runtimeConfig } from "@/config";

export const ServiceContext = createContext<ServiceContainer | null>(null);

// Module-level singleton to survive React StrictMode unmount/remount cycles
let globalContainer: ServiceContainer | null = null;
let globalConfig: AppConfig | null = null;
let bootstrapPromise: Promise<ServiceContainer> | null = null;

function getOrCreateContainer(config: AppConfig): Promise<ServiceContainer> {
  // If we have a container and the config matches, reuse it
  if (
    globalContainer &&
    globalConfig &&
    globalConfig.mode === config.mode &&
    globalConfig.apiBaseUrl === config.apiBaseUrl
  ) {
    if (runtimeConfig.isDev) {
      console.log("[ServiceProvider] Reusing existing global container");
    }
    return Promise.resolve(globalContainer);
  }

  // If bootstrap is already in progress for this config, reuse the promise
  if (bootstrapPromise) return bootstrapPromise;

  // Otherwise create a new one
  if (runtimeConfig.isDev) {
    console.log(
      "[ServiceProvider] Creating new global container, mode:",
      config.mode,
    );
  }
  bootstrapPromise = bootstrapServices(config).then((container) => {
    globalContainer = container;
    globalConfig = config;
    bootstrapPromise = null;
    return container;
  });
  return bootstrapPromise;
}

interface ServiceProviderProps {
  children: ReactNode;
  config?: AppConfig;
}

export const ServiceProvider: React.FC<ServiceProviderProps> = ({
  children,
  config,
}) => {
  // Create config once
  const [effectiveConfig] = useState(() => config || createConfig());
  const [container, setContainer] = useState<ServiceContainer | null>(
    globalContainer,
  );

  // Track mount count for debugging
  const mountCountRef = useRef(0);

  useEffect(() => {
    mountCountRef.current++;
    if (runtimeConfig.isDev) {
      console.log("[ServiceProvider] Mounted, count:", mountCountRef.current);
    }

    // Bootstrap services (async for WASM/Tauri code-splitting)
    if (!container) {
      getOrCreateContainer(effectiveConfig).then(setContainer);
    }

    return () => {
      if (runtimeConfig.isDev) {
        console.log(
          "[ServiceProvider] Cleanup called, mount count:",
          mountCountRef.current,
          "— keeping services alive (module singleton)",
        );
      }
    };
  }, []);

  // Show nothing until services are ready (typically <1ms for server mode,
  // slightly longer for WASM due to dynamic import)
  if (!container) return null;

  return (
    <ServiceContext.Provider value={container}>
      {children}
    </ServiceContext.Provider>
  );
};
