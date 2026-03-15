---
name: setup-dual-mode
description: |
  Scaffold a dependency injection container, service interfaces, mode detection, bootstrap, and React hooks for dual-mode (server + offline/WASM) architecture.
  Use when the user asks to "set up dual mode", "add offline support", "scaffold DI container", or "create service layer for server and WASM modes".
user_invocable: true
---

# Setup Dual-Mode Architecture

This skill generates the full dependency injection infrastructure for a dual-mode application that can run in both **server mode** (API-backed) and **WASM/offline mode** (100% client-side).

References: Chapter 01 of the dual-mode architecture guide.

## Step 1: Gather Requirements

Before generating any code, ask the user the following questions:

1. **What are your domain entities?** (e.g., "screenshots", "annotations", "users", "consensus")
   - For each entity, ask what CRUD operations are needed.
2. **What is your frontend source directory?** (default: `frontend/src`)
3. **What is your mode detection strategy?**
   - Environment variable (default: presence of `VITE_API_BASE_URL`)
   - Runtime config object (e.g., `window.__CONFIG__`)
   - URL parameter
4. **Do you need a processing service?** (e.g., OCR, image processing that runs differently per mode)
5. **Do you need a storage service?** (e.g., blob storage abstraction)

## Step 2: Generate Directory Structure

Create the following directory tree under `{srcDir}/core/`:

```
core/
  interfaces/          # Service contracts
  implementations/
    server/            # API-backed implementations
    wasm/              # Client-side implementations
  di/
    Container.ts
    tokens.ts
    bootstrap.ts
    bootstrapWasm.ts
  hooks/
    useServices.ts
  providers/
    ServiceProvider.tsx
```

## Step 3: Generate Core DI Files

### 3.1 Container.ts

```typescript
// {srcDir}/core/di/Container.ts

export class ServiceContainer {
  private services = new Map<symbol, unknown>();
  private factories = new Map<symbol, () => unknown>();
  private singletons = new Map<symbol, unknown>();

  /**
   * Register a service instance directly.
   */
  register<T>(token: symbol, instance: T): void {
    this.services.set(token, instance);
  }

  /**
   * Register a lazy singleton factory.
   * The factory is called once on first resolve, then cached.
   */
  registerSingleton<T>(token: symbol, factory: () => T): void {
    this.factories.set(token, factory as () => unknown);
  }

  /**
   * Resolve a service by token.
   * Priority: direct registration > singleton cache > factory.
   */
  resolve<T>(token: symbol): T {
    // Direct registration takes priority
    if (this.services.has(token)) {
      return this.services.get(token) as T;
    }

    // Check singleton cache
    if (this.singletons.has(token)) {
      return this.singletons.get(token) as T;
    }

    // Try factory
    if (this.factories.has(token)) {
      const factory = this.factories.get(token)!;
      const instance = factory();
      this.singletons.set(token, instance);
      return instance as T;
    }

    throw new Error(
      `Service not registered: ${token.toString()}. ` +
      `Did you forget to call bootstrap() or register this service?`
    );
  }

  /**
   * Check if a service is registered.
   */
  has(token: symbol): boolean {
    return (
      this.services.has(token) ||
      this.singletons.has(token) ||
      this.factories.has(token)
    );
  }

  /**
   * Clear all registrations. Useful for testing.
   */
  clear(): void {
    this.services.clear();
    this.factories.clear();
    this.singletons.clear();
  }
}

export const container = new ServiceContainer();
```

### 3.2 tokens.ts

Generate one symbol per service interface. Use the entity names gathered in Step 1.

```typescript
// {srcDir}/core/di/tokens.ts

// Core services
export const TOKENS = {
  // Per-entity services (generated from user's entity list)
  {{ENTITY_NAME}}Service: Symbol("{{ENTITY_NAME}}Service"),
  // ... repeat for each entity

  // Infrastructure services
  StorageService: Symbol("StorageService"),
  ProcessingService: Symbol("ProcessingService"),

  // Mode detection
  AppMode: Symbol("AppMode"),
} as const;
```

For each entity the user listed, add a token entry. Example for "screenshots" and "annotations":

```typescript
export const TOKENS = {
  ScreenshotService: Symbol("ScreenshotService"),
  AnnotationService: Symbol("AnnotationService"),
  StorageService: Symbol("StorageService"),
  ProcessingService: Symbol("ProcessingService"),
  AppMode: Symbol("AppMode"),
} as const;
```

### 3.3 bootstrap.ts (Server Mode)

```typescript
// {srcDir}/core/di/bootstrap.ts

import { container } from "./Container";
import { TOKENS } from "./tokens";

// Import server implementations
// import { Server{{Entity}}Service } from "../implementations/server/Server{{Entity}}Service";

export function bootstrapServerMode(): void {
  container.clear();

  container.register(TOKENS.AppMode, "server");

  // Register server implementations
  // container.registerSingleton(TOKENS.{{Entity}}Service, () => new Server{{Entity}}Service());

  console.info("[DI] Bootstrapped in SERVER mode");
}
```

### 3.4 bootstrapWasm.ts (WASM/Offline Mode)

```typescript
// {srcDir}/core/di/bootstrapWasm.ts

import { container } from "./Container";
import { TOKENS } from "./tokens";

// Import WASM implementations
// import { WASM{{Entity}}Service } from "../implementations/wasm/WASM{{Entity}}Service";

export function bootstrapWasmMode(): void {
  container.clear();

  container.register(TOKENS.AppMode, "wasm");

  // Register WASM implementations
  // container.registerSingleton(TOKENS.{{Entity}}Service, () => new WASM{{Entity}}Service());

  console.info("[DI] Bootstrapped in WASM mode");
}
```

### 3.5 ServiceProvider.tsx

```typescript
// {srcDir}/core/providers/ServiceProvider.tsx

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { container, type ServiceContainer } from "../di/Container";
import { bootstrapServerMode } from "../di/bootstrap";
import { bootstrapWasmMode } from "../di/bootstrapWasm";

type AppMode = "server" | "wasm";

interface ServiceContextValue {
  container: ServiceContainer;
  mode: AppMode;
  ready: boolean;
}

const ServiceContext = createContext<ServiceContextValue | null>(null);

function detectMode(): AppMode {
  // Default strategy: check for VITE_API_BASE_URL
  const apiUrl = import.meta.env.VITE_API_BASE_URL
    ?? (window as any).__CONFIG__?.VITE_API_BASE_URL;
  return apiUrl ? "server" : "wasm";
}

interface ServiceProviderProps {
  children: ReactNode;
  forceMode?: AppMode; // For testing
}

export function ServiceProvider({ children, forceMode }: ServiceProviderProps) {
  const [ready, setReady] = useState(false);
  const mode = forceMode ?? detectMode();

  useEffect(() => {
    if (mode === "server") {
      bootstrapServerMode();
    } else {
      bootstrapWasmMode();
    }
    setReady(true);
  }, [mode]);

  if (!ready) {
    return null; // Or a loading spinner
  }

  return (
    <ServiceContext.Provider value={{ container, mode, ready }}>
      {children}
    </ServiceContext.Provider>
  );
}

export function useServiceContext(): ServiceContextValue {
  const ctx = useContext(ServiceContext);
  if (!ctx) {
    throw new Error("useServiceContext must be used within a ServiceProvider");
  }
  return ctx;
}
```

### 3.6 useServices.ts

```typescript
// {srcDir}/core/hooks/useServices.ts

import { useMemo } from "react";
import { TOKENS } from "../di/tokens";
import { useServiceContext } from "../providers/ServiceProvider";

// Import interface types
// import type { I{{Entity}}Service } from "../interfaces/I{{Entity}}Service";

export function useServices() {
  const { container, mode } = useServiceContext();

  return useMemo(
    () => ({
      mode,
      // Expose each service (generated from entity list)
      // {{entityCamel}}Service: container.resolve<I{{Entity}}Service>(TOKENS.{{Entity}}Service),
    }),
    [container, mode]
  );
}

// Convenience hooks for individual services
// export function use{{Entity}}Service(): I{{Entity}}Service {
//   const { container } = useServiceContext();
//   return container.resolve<I{{Entity}}Service>(TOKENS.{{Entity}}Service);
// }
```

## Step 4: Generate Interface Files

For each entity the user specified, generate an interface file.

Template for `I{{Entity}}Service.ts`:

```typescript
// {srcDir}/core/interfaces/I{{Entity}}Service.ts

export interface I{{Entity}}Service {
  /**
   * Retrieve a single {{entity}} by ID.
   */
  getById(id: string | number): Promise<{{Entity}} | null>;

  /**
   * List {{entities}} with optional filters.
   */
  list(filters?: Record<string, unknown>): Promise<{{Entity}}[]>;

  /**
   * Create a new {{entity}}.
   */
  create(data: Create{{Entity}}Input): Promise<{{Entity}}>;

  /**
   * Update an existing {{entity}}.
   */
  update(id: string | number, data: Partial<Create{{Entity}}Input>): Promise<{{Entity}}>;

  /**
   * Delete a {{entity}}.
   */
  delete(id: string | number): Promise<void>;
}
```

Ask the user if they want additional methods beyond basic CRUD for each entity.

## Step 5: Generate Stub Implementations

For each entity, generate two stub files:

### Server implementation stub

```typescript
// {srcDir}/core/implementations/server/Server{{Entity}}Service.ts

import type { I{{Entity}}Service } from "../../interfaces/I{{Entity}}Service";

export class Server{{Entity}}Service implements I{{Entity}}Service {
  async getById(id: string | number) {
    // TODO: implement with apiClient
    throw new Error("Not implemented");
  }

  async list(filters?: Record<string, unknown>) {
    // TODO: implement with apiClient
    throw new Error("Not implemented");
  }

  async create(data: any) {
    // TODO: implement with apiClient
    throw new Error("Not implemented");
  }

  async update(id: string | number, data: any) {
    // TODO: implement with apiClient
    throw new Error("Not implemented");
  }

  async delete(id: string | number) {
    // TODO: implement with apiClient
    throw new Error("Not implemented");
  }
}
```

### WASM implementation stub

```typescript
// {srcDir}/core/implementations/wasm/WASM{{Entity}}Service.ts

import type { I{{Entity}}Service } from "../../interfaces/I{{Entity}}Service";

export class WASM{{Entity}}Service implements I{{Entity}}Service {
  async getById(id: string | number) {
    // TODO: implement with IndexedDB / Dexie
    throw new Error("Not implemented");
  }

  async list(filters?: Record<string, unknown>) {
    // TODO: implement with IndexedDB / Dexie
    throw new Error("Not implemented");
  }

  async create(data: any) {
    // TODO: implement with IndexedDB / Dexie
    throw new Error("Not implemented");
  }

  async update(id: string | number, data: any) {
    // TODO: implement with IndexedDB / Dexie
    throw new Error("Not implemented");
  }

  async delete(id: string | number) {
    // TODO: implement with IndexedDB / Dexie
    throw new Error("Not implemented");
  }
}
```

## Step 6: Wire Into App Entry Point

Instruct the user (or apply the edit) to wrap their app root with `<ServiceProvider>`:

```typescript
// main.tsx or App.tsx
import { ServiceProvider } from "./core/providers/ServiceProvider";

function App() {
  return (
    <ServiceProvider>
      {/* existing app content */}
    </ServiceProvider>
  );
}
```

## Checklist: Adding a New Service Later

When the user needs to add a new service to this DI setup, follow these steps:

1. **Create the interface**: `core/interfaces/INewService.ts`
2. **Add a token**: Add `NewService: Symbol("NewService")` to `tokens.ts`
3. **Create server implementation**: `core/implementations/server/ServerNewService.ts`
4. **Create WASM implementation**: `core/implementations/wasm/WASMNewService.ts`
5. **Register in bootstrap.ts**: Add `container.registerSingleton(TOKENS.NewService, () => new ServerNewService())`
6. **Register in bootstrapWasm.ts**: Add `container.registerSingleton(TOKENS.NewService, () => new WASMNewService())`
7. **Expose in useServices.ts**: Add to the returned object
8. **Optionally**: Create a dedicated `useNewService()` convenience hook

## Validation

After generating all files, run:

```bash
cd frontend && npx tsc --noEmit
```

Report any type errors and fix them before finishing.
