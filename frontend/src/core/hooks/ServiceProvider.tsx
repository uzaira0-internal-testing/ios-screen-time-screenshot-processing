import React, {
  createContext,
  useRef,
  useEffect,
  ReactNode,
  useState,
} from "react";
import { ServiceContainer, bootstrapServices } from "../di";
import { createConfig, AppConfig } from "../config";

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
    if (import.meta.env.DEV) {
      console.log("[ServiceProvider] Reusing existing global container");
    }
    return globalContainer;
  }

  // Otherwise create a new one
  if (import.meta.env.DEV) {
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
    if (import.meta.env.DEV) {
      console.log("[ServiceProvider] Mounted, count:", mountCountRef.current);
    }

    // Only destroy on actual unmount (not StrictMode remount)
    // In production, cleanup is important. In dev with StrictMode, we skip cleanup
    // to avoid the double-mount issue destroying services
    return () => {
      if (import.meta.env.DEV) {
        console.log(
          "[ServiceProvider] Cleanup called, mount count:",
          mountCountRef.current,
        );
      }
      // In development, don't destroy services on unmount because StrictMode
      // will immediately remount and the services would be gone
      // In production (no StrictMode), this cleanup is fine
      if (import.meta.env.PROD) {
        if (import.meta.env.DEV) {
          console.log("[ServiceProvider] Production mode - destroying services");
        }
        if (globalContainer) {
          globalContainer.destroy();
          globalContainer = null;
          globalConfig = null;
        }
      } else {
        if (import.meta.env.DEV) {
          console.log(
            "[ServiceProvider] Dev mode - keeping services for StrictMode compatibility",
          );
        }
      }
    };
  }, []);

  return (
    <ServiceContext.Provider value={container}>
      {children}
    </ServiceContext.Provider>
  );
};
