import { create } from "zustand";
import { syncService } from "./SyncService";

export interface SyncError {
  message: string;
  timestamp: string;
}

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: string | null;
  pendingUploads: number;
  pendingDownloads: number;
  serverUrl: string;
  username: string;
  errors: SyncError[];

  // Actions
  setServerUrl: (url: string) => void;
  setUsername: (username: string) => void;
  syncNow: () => Promise<void>;
  refreshPendingCounts: () => Promise<void>;
  clearErrors: () => void;
}

export const useSyncStore = create<SyncState>((set, get) => {
  // Listen for online/offline events
  if (typeof window !== "undefined") {
    const updateOnline = () => set({ isOnline: navigator.onLine });
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
  }

  return {
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    isSyncing: false,
    lastSyncAt: null,
    pendingUploads: 0,
    pendingDownloads: 0,
    serverUrl: "",
    username: "",
    errors: [],

    setServerUrl: (url: string) => {
      set({ serverUrl: url });
      const { username } = get();
      if (url && username) {
        syncService.configure({ serverUrl: url, username });
      }
    },

    setUsername: (username: string) => {
      set({ username });
      const { serverUrl } = get();
      if (serverUrl && username) {
        syncService.configure({ serverUrl, username });
      }
    },

    syncNow: async () => {
      const { serverUrl, username } = get();
      if (!serverUrl || !username) {
        set({
          errors: [
            ...get().errors,
            {
              message: "Server URL and username are required",
              timestamp: new Date().toISOString(),
            },
          ],
        });
        return;
      }

      syncService.configure({ serverUrl, username });
      set({ isSyncing: true, errors: [] });

      try {
        const isHealthy = await syncService.checkServerHealth();
        if (!isHealthy) {
          set({
            isSyncing: false,
            errors: [
              {
                message: "Cannot reach server. Check URL and try again.",
                timestamp: new Date().toISOString(),
              },
            ],
          });
          return;
        }

        const result = await syncService.sync((progress) => {
          set({
            pendingUploads:
              progress.phase === "push"
                ? progress.total - progress.current
                : get().pendingUploads,
          });
        });

        const syncErrors: SyncError[] = result.errors.map((msg) => ({
          message: msg,
          timestamp: new Date().toISOString(),
        }));

        set({
          isSyncing: false,
          lastSyncAt: new Date().toISOString(),
          errors: syncErrors,
        });

        // Refresh counts after sync
        await get().refreshPendingCounts();
      } catch (err) {
        set({
          isSyncing: false,
          errors: [
            {
              message:
                err instanceof Error ? err.message : "Sync failed",
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }
    },

    refreshPendingCounts: async () => {
      try {
        const counts = await syncService.getPendingCounts();
        set({
          pendingUploads: counts.pendingUploads,
          pendingDownloads: counts.pendingDownloads,
        });
      } catch {
        // Silently fail - counts are informational
      }
    },

    clearErrors: () => set({ errors: [] }),
  };
});
