---
name: setup-offline-storage
description: Sets up Dexie (IndexedDB) schema, OPFS blob storage with LRU cache, and IStorageService for offline-first applications. Generates database class, blob storage module, service interface, and implementation.
user_invocable: true
---

# Setup Offline Storage

This skill scaffolds a complete offline-first storage layer using IndexedDB (via Dexie) for structured data and the Origin Private File System (OPFS) for blob storage. It generates typed interfaces and implementations following the service container pattern.

## When Invoked

Ask the user the following questions before generating any code:

1. **What entity types need to be stored?**
   - List each entity with its fields and types (e.g., `Screenshot: { id, filename, status, createdAt }`).
   - Which fields need indexes? (fields used in queries, filters, sorts)
   - Are there compound indexes needed? (e.g., `[status+type]` for filtering by two fields at once)

2. **Do you need blob storage?**
   - Will the app store images, files, or other binary data?
   - Approximate size range per blob (KB? MB? 100MB+?)
   - How many blobs will be stored concurrently? (affects LRU cache sizing)

3. **What indexes are required?**
   - For each entity: which queries will be performed?
   - Any multi-field filters? (compound indexes)
   - Any unique constraints beyond the primary key?

## Architecture (references Chapter 03)

```
src/core/
├── interfaces/
│   └── IStorageService.ts              # Storage contract
├── implementations/
│   └── wasm/
│       └── storage/
│           ├── database/
│           │   └── AppDB.ts            # Dexie database class with schema
│           ├── blobs/
│           │   └── OpfsBlobStorage.ts   # OPFS blob storage with LRU cache
│           └── IndexedDBStorageService.ts  # IStorageService implementation
```

## Generated Files

### 1. Dexie Database Class (`AppDB.ts`)

Dexie provides a typed wrapper around IndexedDB with a declarative schema DSL, versioned migrations, and reactive queries.

```typescript
import Dexie, { type Table } from "dexie";

// ============================================================
// Entity Types
// ============================================================

export interface Item {
  /** Auto-incremented primary key */
  id?: number;
  /** Unique external identifier */
  externalId: string;
  /** Processing status */
  status: "pending" | "processing" | "completed" | "failed";
  /** Entity type for compound index filtering */
  type: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface Annotation {
  id?: number;
  itemId: number;
  userId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// ============================================================
// Database Class
// ============================================================

export class AppDB extends Dexie {
  items!: Table<Item, number>;
  annotations!: Table<Annotation, number>;

  constructor(dbName = "AppDB") {
    super(dbName);

    // ---------------------------------------------------------
    // Version 1: Initial schema
    // ---------------------------------------------------------
    this.version(1).stores({
      // Index syntax:
      //   ++id        = auto-increment primary key
      //   &externalId = unique index
      //   status      = simple index
      //   [status+type] = compound index (efficient multi-field queries)
      //   createdAt   = range queries and sorting
      items: "++id, &externalId, status, type, createdAt, [status+type]",
      annotations: "++id, itemId, userId, createdAt",
    });

    // ---------------------------------------------------------
    // Version 2: Example migration adding a new table/index
    // ---------------------------------------------------------
    // this.version(2).stores({
    //   items: "++id, &externalId, status, type, createdAt, [status+type], category",
    //   annotations: "++id, itemId, userId, createdAt",
    //   tags: "++id, &name",
    // }).upgrade(async (tx) => {
    //   // Data migration: backfill the new 'category' field
    //   await tx.table("items").toCollection().modify((item) => {
    //     item.category = item.metadata?.category ?? "uncategorized";
    //   });
    // });
  }
}

// Singleton instance (safe because Dexie deduplicates by name)
export const db = new AppDB();
```

**Dexie index syntax reference:**

| Prefix | Meaning | Example |
|--------|---------|---------|
| `++` | Auto-increment primary key | `++id` |
| `&` | Unique index | `&externalId` |
| `*` | Multi-entry index (array field) | `*tags` |
| `[a+b]` | Compound index | `[status+type]` |
| _(none)_ | Simple index | `status` |

### 2. OPFS Blob Storage (`OpfsBlobStorage.ts`)

The Origin Private File System (OPFS) provides a high-performance, quota-managed filesystem that is invisible to the user. Combined with an LRU cache of Blob URLs, this avoids redundant reads and keeps memory bounded.

```typescript
// ============================================================
// OPFS Blob Storage with LRU Cache
// ============================================================

/** Maximum number of Blob URLs to hold in memory */
const MAX_CACHE_SIZE = 200;

/** URL cache: entity ID -> blob URL */
const urlCache = new Map<number, string>();

/** Access-ordered list for LRU eviction (most recent at end) */
const cacheAccessOrder: number[] = [];

/** Deduplication: prevents concurrent reads for the same ID from racing */
const inFlight = new Map<number, Promise<string | null>>();

/** Lazy-initialized OPFS root handle */
let opfsRoot: FileSystemDirectoryHandle | null = null;

/** Tri-state: null = unknown, true = available, false = not available */
let opfsAvailable: boolean | null = null;

// ----------------------------------------------------------
// OPFS Directory Handle
// ----------------------------------------------------------

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (opfsAvailable === false) return null;
  if (opfsRoot) return opfsRoot;

  try {
    const root = await navigator.storage.getDirectory();
    opfsRoot = await root.getDirectoryHandle("blobs", { create: true });
    opfsAvailable = true;
    return opfsRoot;
  } catch {
    opfsAvailable = false;
    return null;
  }
}

// ----------------------------------------------------------
// LRU Cache Management
// ----------------------------------------------------------

function touchCacheEntry(id: number): void {
  const idx = cacheAccessOrder.indexOf(id);
  if (idx !== -1) cacheAccessOrder.splice(idx, 1);
  cacheAccessOrder.push(id);
}

function evictIfNeeded(): void {
  while (urlCache.size > MAX_CACHE_SIZE && cacheAccessOrder.length > 0) {
    const evictId = cacheAccessOrder.shift()!;
    const url = urlCache.get(evictId);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(evictId);
    }
  }
}

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------

/**
 * Store a blob in OPFS. Falls back to no-op if OPFS is unavailable.
 */
export async function storeBlob(id: number, blob: Blob): Promise<void> {
  const root = await getOpfsRoot();
  if (!root) return;

  const filename = `blob_${id}`;
  const fileHandle = await root.getFileHandle(filename, { create: true });

  // Use createWritable for atomic writes
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  // Invalidate cached URL for this ID (blob content may have changed)
  const existingUrl = urlCache.get(id);
  if (existingUrl) {
    URL.revokeObjectURL(existingUrl);
    urlCache.delete(id);
    const idx = cacheAccessOrder.indexOf(id);
    if (idx !== -1) cacheAccessOrder.splice(idx, 1);
  }
}

/**
 * Retrieve a blob URL from OPFS. Returns cached URL if available.
 * Returns null if the blob does not exist or OPFS is unavailable.
 */
export async function getBlobUrl(id: number): Promise<string | null> {
  // Check cache first
  const cached = urlCache.get(id);
  if (cached) {
    touchCacheEntry(id);
    return cached;
  }

  // Deduplicate concurrent reads for the same ID
  const existing = inFlight.get(id);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const root = await getOpfsRoot();
      if (!root) return null;

      const filename = `blob_${id}`;
      const fileHandle = await root.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);

      urlCache.set(id, url);
      touchCacheEntry(id);
      evictIfNeeded();

      return url;
    } catch {
      // File does not exist
      return null;
    } finally {
      inFlight.delete(id);
    }
  })();

  inFlight.set(id, promise);
  return promise;
}

/**
 * Delete a blob from OPFS and revoke its cached URL.
 */
export async function deleteBlob(id: number): Promise<void> {
  const root = await getOpfsRoot();
  if (!root) return;

  const filename = `blob_${id}`;
  try {
    await root.removeEntry(filename);
  } catch {
    // File did not exist -- not an error
  }

  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
    const idx = cacheAccessOrder.indexOf(id);
    if (idx !== -1) cacheAccessOrder.splice(idx, 1);
  }
}

/**
 * Revoke all cached Blob URLs. Call this on app teardown or memory pressure.
 */
export function revokeAllUrls(): void {
  urlCache.forEach((url) => URL.revokeObjectURL(url));
  urlCache.clear();
  cacheAccessOrder.length = 0;
}

/**
 * List all blob IDs stored in OPFS.
 */
export async function listBlobIds(): Promise<number[]> {
  const root = await getOpfsRoot();
  if (!root) return [];

  const ids: number[] = [];
  for await (const name of (root as any).keys()) {
    const match = (name as string).match(/^blob_(\d+)$/);
    if (match) ids.push(parseInt(match[1], 10));
  }
  return ids;
}
```

### 3. Storage Service Interface (`IStorageService.ts`)

```typescript
/**
 * Abstraction over storage backends.
 * Server mode: delegates to REST API.
 * WASM mode: uses IndexedDB + OPFS.
 */
export interface IStorageService {
  // ----- Entity CRUD -----

  /** Create or update an entity. Returns the assigned ID. */
  put<T extends { id?: number }>(table: string, entity: T): Promise<number>;

  /** Get an entity by primary key. Returns undefined if not found. */
  get<T>(table: string, id: number): Promise<T | undefined>;

  /** Delete an entity by primary key. */
  delete(table: string, id: number): Promise<void>;

  /** Query entities with optional filters and pagination. */
  query<T>(
    table: string,
    options?: QueryOptions,
  ): Promise<{ items: T[]; total: number }>;

  // ----- Blob Storage -----

  /** Store a binary blob associated with an entity ID. */
  storeBlob(id: number, blob: Blob): Promise<void>;

  /** Get a blob URL for display. Returns null if not found. */
  getBlobUrl(id: number): Promise<string | null>;

  /** Delete a blob associated with an entity ID. */
  deleteBlob(id: number): Promise<void>;

  // ----- Lifecycle -----

  /** Request persistent storage from the browser. */
  requestPersistentStorage(): Promise<boolean>;

  /** Get storage usage statistics. */
  getStorageEstimate(): Promise<{ usage: number; quota: number }>;

  /** Clear all data (both IndexedDB and OPFS). Use with caution. */
  clearAll(): Promise<void>;
}

export interface QueryOptions {
  /** Index to query on */
  index?: string;
  /** Value or range for the index */
  equals?: string | number;
  /** Lower bound for range queries */
  above?: string | number;
  /** Upper bound for range queries */
  below?: string | number;
  /** Sort direction */
  order?: "asc" | "desc";
  /** Number of results to skip */
  offset?: number;
  /** Maximum results to return */
  limit?: number;
}
```

### 4. IndexedDB Storage Service Implementation (`IndexedDBStorageService.ts`)

```typescript
import type { IStorageService, QueryOptions } from "@/core/interfaces/IStorageService";
import { db } from "./database/AppDB";
import {
  storeBlob,
  getBlobUrl,
  deleteBlob,
  revokeAllUrls,
} from "./blobs/OpfsBlobStorage";

export class IndexedDBStorageService implements IStorageService {

  // ----- Entity CRUD -----

  async put<T extends { id?: number }>(
    table: string,
    entity: T,
  ): Promise<number> {
    const dexieTable = db.table(table);
    const id = await dexieTable.put(entity);
    return id as number;
  }

  async get<T>(table: string, id: number): Promise<T | undefined> {
    const dexieTable = db.table(table);
    return (await dexieTable.get(id)) as T | undefined;
  }

  async delete(table: string, id: number): Promise<void> {
    const dexieTable = db.table(table);
    await dexieTable.delete(id);
  }

  async query<T>(
    table: string,
    options?: QueryOptions,
  ): Promise<{ items: T[]; total: number }> {
    const dexieTable = db.table(table);
    let collection = dexieTable.toCollection();

    // Apply index-based filtering
    if (options?.index && options.equals !== undefined) {
      collection = dexieTable.where(options.index).equals(options.equals);
    } else if (options?.index && options.above !== undefined && options.below !== undefined) {
      collection = dexieTable
        .where(options.index)
        .between(options.above, options.below);
    } else if (options?.index && options.above !== undefined) {
      collection = dexieTable.where(options.index).above(options.above);
    } else if (options?.index && options.below !== undefined) {
      collection = dexieTable.where(options.index).below(options.below);
    }

    // Get total before pagination
    const total = await collection.count();

    // Apply sorting
    if (options?.order === "desc") {
      collection = collection.reverse();
    }

    // Apply pagination
    if (options?.offset) {
      collection = collection.offset(options.offset);
    }
    if (options?.limit) {
      collection = collection.limit(options.limit);
    }

    const items = (await collection.toArray()) as T[];
    return { items, total };
  }

  // ----- Blob Storage -----

  async storeBlob(id: number, blob: Blob): Promise<void> {
    return storeBlob(id, blob);
  }

  async getBlobUrl(id: number): Promise<string | null> {
    return getBlobUrl(id);
  }

  async deleteBlob(id: number): Promise<void> {
    return deleteBlob(id);
  }

  // ----- Lifecycle -----

  async requestPersistentStorage(): Promise<boolean> {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      console.log(
        granted
          ? "Persistent storage granted"
          : "Persistent storage denied -- data may be evicted under storage pressure",
      );
      return granted;
    }
    console.warn("Persistent storage API not available");
    return false;
  }

  async getStorageEstimate(): Promise<{ usage: number; quota: number }> {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      };
    }
    return { usage: 0, quota: 0 };
  }

  async clearAll(): Promise<void> {
    // Clear IndexedDB tables
    await db.delete();

    // Clear OPFS blobs
    revokeAllUrls();
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("blobs", { recursive: true });
    } catch {
      // OPFS not available or directory doesn't exist
    }

    // Re-open database (Dexie requires this after delete)
    await db.open();
  }
}
```

## Pre-Migration Backup Pattern

Before running a schema upgrade that restructures existing tables, back up metadata to OPFS as a JSON file. This protects against data loss if the migration fails partway through.

```typescript
import Dexie from "dexie";

/**
 * Back up a Dexie table's contents to OPFS as JSON before a schema migration.
 * Call this inside a .version(N).upgrade() callback.
 */
async function backupTableToOpfs(
  tableName: string,
  tx: Dexie.Transaction,
): Promise<void> {
  try {
    const rows = await tx.table(tableName).toArray();
    const json = JSON.stringify(rows);
    const blob = new Blob([json], { type: "application/json" });

    const root = await navigator.storage.getDirectory();
    const backupsDir = await root.getDirectoryHandle("migration-backups", {
      create: true,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${tableName}_v${tx.db.verno}_${timestamp}.json`;
    const fileHandle = await backupsDir.getFileHandle(filename, {
      create: true,
    });

    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    console.log(
      `Backed up ${rows.length} rows from '${tableName}' to OPFS: ${filename}`,
    );
  } catch (err) {
    console.warn(`Failed to back up '${tableName}' to OPFS:`, err);
    // Non-fatal: migration should still proceed
  }
}

// Usage in a Dexie migration:
// this.version(3).stores({ ... }).upgrade(async (tx) => {
//   await backupTableToOpfs("items", tx);
//   // ... perform destructive migration ...
// });
```

To restore from a backup:

```typescript
async function restoreTableFromOpfs(
  tableName: string,
  backupFilename: string,
): Promise<unknown[]> {
  const root = await navigator.storage.getDirectory();
  const backupsDir = await root.getDirectoryHandle("migration-backups");
  const fileHandle = await backupsDir.getFileHandle(backupFilename);
  const file = await fileHandle.getFile();
  const json = await file.text();
  return JSON.parse(json);
}
```

## Persistent Storage Best Practices

1. **Request persistence early** -- call `requestPersistentStorage()` during app initialization, before writing any data. Browsers may auto-grant it for installed PWAs or sites with high engagement.

2. **Monitor quota** -- use `getStorageEstimate()` to show users how much space is used. IndexedDB + OPFS share the same origin quota (typically 60% of disk on Chrome, 10% on Firefox).

3. **Eviction defense** -- without persistent storage, the browser may evict your data under storage pressure. Critical data should be exportable (JSON/CSV download) as a fallback.

4. **OPFS vs IndexedDB for blobs** -- Store blobs in OPFS, not IndexedDB. IndexedDB stores blobs inline, which bloats the database file and slows down queries on the metadata tables. OPFS keeps blobs as separate files on disk.

5. **Blob URL lifecycle** -- Always revoke Blob URLs when components unmount or blobs are no longer displayed. Leaked URLs prevent garbage collection of the underlying `Blob` object.

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| IndexedDB | Yes | Yes | Yes | Yes |
| Dexie.js | Yes | Yes | Yes | Yes |
| OPFS | 86+ | 111+ | 15.2+ | 86+ |
| `navigator.storage.persist()` | 52+ | 55+ | 15.2+ | 79+ |
| `navigator.storage.estimate()` | 52+ | 57+ | 17+ | 79+ |

For browsers without OPFS support, fall back to storing blobs directly in IndexedDB (Dexie supports `Blob` fields natively, just with worse performance).

## Common Pitfalls

1. **Dexie version numbering must be monotonically increasing.** Never reuse or skip version numbers. Each `.version(N)` call must have N > all previous versions.

2. **Compound index field order matters.** `[status+type]` is not the same as `[type+status]`. The first field is the primary sort/filter key. Choose the field with higher selectivity first.

3. **OPFS `createWritable()` locks the file.** Do not call `getFile()` on the same handle while a writable stream is open. Always `await writable.close()` before reading.

4. **IndexedDB transactions auto-commit on `await`.** If you `await` a non-Dexie promise inside a transaction callback, the transaction may auto-commit. Use `Dexie.waitFor()` to keep the transaction alive across async boundaries.

5. **Safari OPFS limitations.** Safari's OPFS implementation does not support `createSyncAccessHandle()` (used for synchronous read/write in workers). Use the async `createWritable()`/`getFile()` API for cross-browser compatibility.
