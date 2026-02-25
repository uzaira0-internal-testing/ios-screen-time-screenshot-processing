import { create } from "zustand";
import { api } from "@/services/apiClient";
import type {
  Screenshot,
  Group,
  PreprocessingStageSummary,
  PreprocessingSummary,
  PreprocessingEvent,
  PreprocessingEventLog,
} from "@/types";
import toast from "react-hot-toast";

// Local types not in backend schema (UI-only concerns)
type Stage = "device_detection" | "cropping" | "phi_detection" | "phi_redaction";
type StageStatus = "pending" | "completed" | "running" | "failed" | "invalidated";
type FilterMode = "all" | "needs_review" | "invalidated" | "completed" | "pending";

// Re-use generated types
type StageSummary = PreprocessingStageSummary;
type PreprocessingSummaryData = PreprocessingSummary;
type PreprocessingEventData = PreprocessingEvent;
type EventLogData = PreprocessingEventLog;

const STAGES: Stage[] = [
  "device_detection",
  "cropping",
  "phi_detection",
  "phi_redaction",
];

interface PreprocessingState {
  // Data
  screenshots: Screenshot[];
  selectedGroupId: string;
  groups: Group[];
  summary: PreprocessingSummaryData | null;

  // Navigation
  activeStage: Stage;

  // Execution
  isRunningStage: boolean;
  stageProgress: { completed: number; total: number } | null;

  // Filtering
  filter: FilterMode;

  // Options
  phiPreset: string;
  redactionMethod: string;

  // Event log detail
  selectedScreenshotId: number | null;
  eventLog: EventLogData | null;

  // Loading state
  isLoading: boolean;

  // Polling
  _pollInterval: ReturnType<typeof setInterval> | null;
  _pollCount: number;
  _queuedCount: number;

  // Actions
  setActiveStage: (stage: Stage) => void;
  setFilter: (filter: FilterMode) => void;
  setSelectedGroupId: (groupId: string) => void;
  setPhiPreset: (preset: string) => void;
  setRedactionMethod: (method: string) => void;

  loadGroups: () => Promise<void>;
  loadScreenshots: () => Promise<void>;
  loadSummary: () => Promise<void>;
  runStage: (stage: Stage, screenshotIds?: number[]) => Promise<void>;
  invalidateFromStage: (screenshotId: number, stage: string) => Promise<void>;
  loadEventLog: (screenshotId: number) => Promise<void>;
  clearEventLog: () => void;

  // Polling
  startPolling: () => void;
  stopPolling: () => void;

  // Derived helpers
  getStageStatus: (stage: Stage) => StageSummary;
  getScreenshotsForStage: (stage: Stage) => Screenshot[];
  getScreenshotStageStatus: (screenshot: Screenshot, stage: Stage) => StageStatus;
  isScreenshotException: (screenshot: Screenshot, stage: Stage) => boolean;
}

export const usePreprocessingStore = create<PreprocessingState>((set, get) => ({
  // Initial state
  screenshots: [],
  selectedGroupId: "",
  groups: [],
  summary: null,
  activeStage: "device_detection",
  isRunningStage: false,
  stageProgress: null,
  filter: "all",
  phiPreset: "hipaa_compliant",
  redactionMethod: "redbox",
  selectedScreenshotId: null,
  eventLog: null,
  isLoading: false,
  _pollInterval: null,
  _pollCount: 0,
  _queuedCount: 0,

  setActiveStage: (stage) => set({ activeStage: stage }),
  setFilter: (filter) => set({ filter }),
  setSelectedGroupId: (groupId) => {
    set({ selectedGroupId: groupId, screenshots: [], summary: null });
    // Auto-load when group changes
    get().loadScreenshots();
    get().loadSummary();
  },
  setPhiPreset: (preset) => set({ phiPreset: preset }),
  setRedactionMethod: (method) => set({ redactionMethod: method }),

  loadGroups: async () => {
    try {
      const data = await api.groups.list();
      if (data && data.length > 0) {
        set({ groups: data });
        if (!get().selectedGroupId) {
          get().setSelectedGroupId(data[0]!.id);
        }
      }
    } catch (err) {
      console.error("Failed to load groups:", err);
    }
  },

  loadScreenshots: async () => {
    const { selectedGroupId } = get();
    if (!selectedGroupId) {
      set({ screenshots: [] });
      return;
    }

    set({ isLoading: true });
    try {
      const data = await api.screenshots.list({
        group_id: selectedGroupId,
        page_size: 500,
        sort_by: "id",
        sort_order: "asc",
      });
      if (data) {
        set({ screenshots: data.items });
      }
    } catch (err) {
      console.error("Failed to load screenshots:", err);
      toast.error("Failed to load screenshots");
    } finally {
      set({ isLoading: false });
    }
  },

  loadSummary: async () => {
    const { selectedGroupId } = get();
    if (!selectedGroupId) return;

    try {
      const data = await api.preprocessing.getSummary(selectedGroupId);
      if (data) {
        set({ summary: data as PreprocessingSummaryData });
      }
    } catch (err) {
      console.error("Failed to load preprocessing summary:", err);
    }
  },

  runStage: async (stage, screenshotIds) => {
    const { selectedGroupId, phiPreset, redactionMethod } = get();
    if (!selectedGroupId && !screenshotIds) return;

    set({ isRunningStage: true, stageProgress: null, _pollCount: 0, _queuedCount: 0 });
    try {
      const result = await api.preprocessing.runStage(stage, {
        group_id: selectedGroupId || undefined,
        screenshot_ids: screenshotIds,
        phi_pipeline_preset: phiPreset,
        phi_redaction_method: redactionMethod,
      });
      if (result && result.queued_count > 0) {
        toast.success(result.message);
        set({
          stageProgress: { completed: 0, total: result.queued_count },
          _queuedCount: result.queued_count,
        });
        // Start polling for completion
        get().startPolling();
      } else {
        // Nothing queued — done immediately
        if (result) toast.success(result.message);
        set({ isRunningStage: false });
        await get().loadScreenshots();
        await get().loadSummary();
      }
    } catch (err) {
      console.error(`Failed to run ${stage}:`, err);
      toast.error(`Failed to queue ${stage}`);
      set({ isRunningStage: false });
    }
  },

  invalidateFromStage: async (screenshotId, stage) => {
    try {
      await api.preprocessing.invalidateFromStage(screenshotId, stage);
      toast.success(`Downstream stages invalidated from ${stage.replace(/_/g, " ")}`);
      get().loadScreenshots();
      get().loadSummary();
    } catch (err) {
      console.error("Failed to invalidate:", err);
      toast.error("Failed to invalidate stages");
    }
  },

  loadEventLog: async (screenshotId) => {
    try {
      const data = await api.preprocessing.getEventLog(screenshotId);
      set({ selectedScreenshotId: screenshotId, eventLog: data as EventLogData });
    } catch (err) {
      console.error("Failed to load event log:", err);
      toast.error("Failed to load event log");
    }
  },

  clearEventLog: () => set({ selectedScreenshotId: null, eventLog: null }),

  startPolling: () => {
    const existing = get()._pollInterval;
    if (existing) clearInterval(existing);

    const interval = setInterval(async () => {
      set({ _pollCount: get()._pollCount + 1 });
      await get().loadSummary();
      const summary = get().summary;
      if (summary) {
        const stage = get().activeStage;
        const stageSummary = summary[stage];
        const pollCount = get()._pollCount;
        // Wait at least 3 polls (6s) before concluding "done" to give
        // Celery workers time to pick up tasks and set status to "running"
        const minPollsBeforeComplete = 3;
        if (
          stageSummary &&
          stageSummary.running === 0 &&
          pollCount >= minPollsBeforeComplete
        ) {
          // Done — refresh everything and stop polling
          get().stopPolling();
          await get().loadScreenshots();
          set({ isRunningStage: false, stageProgress: null });
        } else if (stageSummary) {
          set({
            stageProgress: {
              completed: stageSummary.completed,
              total: summary.total,
            },
          });
        }
      }
    }, 2000);

    set({ _pollInterval: interval });
  },

  stopPolling: () => {
    const interval = get()._pollInterval;
    if (interval) {
      clearInterval(interval);
      set({ _pollInterval: null });
    }
  },

  // Derived helpers
  getStageStatus: (stage) => {
    const { summary } = get();
    if (summary) {
      return summary[stage];
    }
    // Compute from screenshots if no summary
    const { screenshots } = get();
    const counts: StageSummary = {
      completed: 0, pending: 0, invalidated: 0,
      running: 0, failed: 0, exceptions: 0,
    };
    for (const s of screenshots) {
      const pp = (s.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
      const stageStatus = (pp?.stage_status as Record<string, string>)?.[stage] ?? "pending";
      if (stageStatus in counts) {
        counts[stageStatus as keyof StageSummary] += 1;
      } else {
        counts.pending += 1;
      }
    }
    return counts;
  },

  getScreenshotsForStage: (stage) => {
    const { screenshots, filter } = get();
    if (filter === "all") return screenshots;

    return screenshots.filter((s) => {
      const status = get().getScreenshotStageStatus(s, stage);
      switch (filter) {
        case "completed":
          return status === "completed";
        case "pending":
          return status === "pending";
        case "invalidated":
          return status === "invalidated";
        case "needs_review":
          return get().isScreenshotException(s, stage);
        default:
          return true;
      }
    });
  },

  getScreenshotStageStatus: (screenshot, stage) => {
    const pp = (screenshot.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
    return ((pp?.stage_status as Record<string, string>)?.[stage] ?? "pending") as StageStatus;
  },

  isScreenshotException: (screenshot, stage) => {
    // Only flag completed stages (matches backend is_exception logic)
    const status = get().getScreenshotStageStatus(screenshot, stage);
    if (status !== "completed") return false;

    const pp = (screenshot.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
    if (!pp) return false;
    const currentEvents = pp.current_events as Record<string, number | null> | undefined;
    const events = pp.events as PreprocessingEventData[] | undefined;
    if (!currentEvents || !events) return false;
    const eid = currentEvents[stage];
    if (!eid) return false;
    const event = events.find((e) => e.event_id === eid);
    if (!event) return false;
    const result = event.result;

    if (stage === "device_detection") {
      if (result.device_category === "unknown") return true;
      if ((result.confidence as number) < 0.7) return true;
    } else if (stage === "cropping") {
      if (result.is_ipad && !result.was_cropped) return true;
    } else if (stage === "phi_detection") {
      if (result.phi_detected) return true;
      if ((result.regions_count as number) > 10) return true;
    } else if (stage === "phi_redaction") {
      if (result.phi_detected && !result.redacted) return true;
    }
    return false;
  },
}));

export type { Stage, StageStatus, FilterMode, StageSummary, PreprocessingSummaryData, PreprocessingEventData, EventLogData };
export { STAGES };
