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

function getOrCreateContainer(config: AppConfig): ServiceContainer {
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
    return globalContainer;
  }

  // Otherwise create a new one
  if (runtimeConfig.isDev) {
    console.log(
      "[ServiceProvider] Creating new global container, mode:",
      config.mode,
    );
  }
  globalContainer = bootstrapServices(config);
  globalConfig = config;
  return globalContainer;
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

  // Get or create the container (uses module-level singleton)
  const container = getOrCreateContainer(effectiveConfig);

  // Track mount count for debugging
  const mountCountRef = useRef(0);

  useEffect(() => {
    mountCountRef.current++;
    if (runtimeConfig.isDev) {
      console.log("[ServiceProvider] Mounted, count:", mountCountRef.current);
    }

    // Module-level singleton should live for the entire page lifetime.
    // Never destroy on React unmount — StrictMode double-mounts would
    // clear services between unmount and re-mount, causing "Service not
    // registered" errors for any component that renders in between.
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

  return (
    <ServiceContext.Provider value={container}>
      {children}
    </ServiceContext.Provider>
  );
};
