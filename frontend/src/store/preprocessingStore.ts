import { create } from "zustand";
import type {
  Screenshot,
  Group,
  PreprocessingStageSummary,
  PreprocessingSummary,
  PreprocessingEvent,
  PreprocessingEventLog,
} from "@/types";
import type { IPreprocessingService } from "@/core/interfaces/IPreprocessingService";
import toast from "react-hot-toast";

// Local types not in backend schema (UI-only concerns)
type Stage = "device_detection" | "cropping" | "phi_detection" | "phi_redaction";
type StageStatus = "pending" | "completed" | "running" | "failed" | "invalidated";
type FilterMode = "all" | "needs_review" | "invalidated" | "completed" | "pending";
type PageMode = "pipeline" | "upload";

interface UploadFileItem {
  file: File;
  participant_id: string;
  filename: string;
  original_filepath: string;
  screenshot_date: string;
  thumbnail?: string;
}

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
  pageMode: PageMode;

  // Execution
  isRunningStage: boolean;
  stageProgress: { completed: number; total: number } | null;

  // Filtering
  filter: FilterMode;

  // Options
  phiPreset: string;
  redactionMethod: string;
  llmEnabled: boolean;
  llmEndpoint: string;
  llmModel: string;

  // Event log detail
  selectedScreenshotId: number | null;
  eventLog: EventLogData | null;

  // Loading state
  isLoading: boolean;

  // Polling
  _pollInterval: ReturnType<typeof setInterval> | null;
  _pollCount: number;
  _queuedCount: number;
  _completedBaseline: number;
  _pollStage: Stage;

  // Upload state (Phase 2)
  uploadFiles: UploadFileItem[];
  uploadImageType: "battery" | "screen_time";
  uploadGroupId: string;
  isUploading: boolean;
  uploadProgress: { completed: number; total: number } | null;
  uploadErrors: string[];

  // Deep-link state
  highlightedScreenshotId: number | null;
  returnUrl: string | null;

  // Queue review mode
  queueMode: boolean;
  queueIndex: number;
  queueScreenshotIds: number[];

  // Actions
  setActiveStage: (stage: Stage) => void;
  setPageMode: (mode: PageMode) => void;
  setFilter: (filter: FilterMode) => void;
  setSelectedGroupId: (groupId: string) => void;
  setPhiPreset: (preset: string) => void;
  setRedactionMethod: (method: string) => void;
  setLlmEnabled: (enabled: boolean) => void;
  setLlmEndpoint: (endpoint: string) => void;
  setLlmModel: (model: string) => void;

  loadGroups: () => Promise<void>;
  loadScreenshots: () => Promise<void>;
  loadSummary: () => Promise<void>;
  runStage: (stage: Stage, screenshotIds?: number[]) => Promise<void>;
  resetStage: (stage: Stage) => Promise<void>;
  invalidateFromStage: (screenshotId: number, stage: string) => Promise<void>;
  loadEventLog: (screenshotId: number) => Promise<void>;
  clearEventLog: () => void;

  // Upload actions (Phase 2)
  setUploadFiles: (files: UploadFileItem[]) => void;
  setUploadImageType: (type: "battery" | "screen_time") => void;
  setUploadGroupId: (groupId: string) => void;
  startBrowserUpload: () => Promise<void>;

  // Queue review actions
  enterQueue: (screenshotIds: number[], startIndex?: number) => void;
  exitQueue: () => void;
  queueNext: () => void;
  queuePrev: () => void;
  queueGoTo: (index: number) => void;

  // Deep-link actions
  setHighlightedScreenshotId: (id: number | null) => void;
  setReturnUrl: (url: string | null) => void;

  // Polling
  startPolling: () => void;
  stopPolling: () => void;

  // Derived helpers
  getStageStatus: (stage: Stage) => StageSummary;
  getScreenshotsForStage: (stage: Stage) => Screenshot[];
  getScreenshotStageStatus: (screenshot: Screenshot, stage: Stage) => StageStatus;
  isScreenshotException: (screenshot: Screenshot, stage: Stage) => boolean;
  getEligibleCount: (stage: Stage) => { eligible: number; blockedByPrereq: number };
}

/**
 * Factory function to create a preprocessing store with an injected service.
 * Server mode passes ServerPreprocessingService, WASM mode passes WASMPreprocessingService.
 */
export function createPreprocessingStore(service: IPreprocessingService) {
  return create<PreprocessingState>((set, get) => ({
  // Initial state
  screenshots: [],
  selectedGroupId: "",
  groups: [],
  summary: null,
  activeStage: "device_detection",
  pageMode: "pipeline",
  isRunningStage: false,
  stageProgress: null,
  filter: "all",
  phiPreset: "screen_time",
  redactionMethod: "redbox",
  llmEnabled: false,
  llmEndpoint: "http://10.23.7.55:1234/v1",
  llmModel: "gpt-oss-20b",
  selectedScreenshotId: null,
  eventLog: null,
  isLoading: false,
  _pollInterval: null,
  _pollCount: 0,
  _queuedCount: 0,
  _completedBaseline: 0,
  _pollStage: "device_detection",

  // Upload state
  uploadFiles: [],
  uploadImageType: "screen_time",
  uploadGroupId: "",
  isUploading: false,
  uploadProgress: null,
  uploadErrors: [],

  // Deep-link state
  highlightedScreenshotId: null,
  returnUrl: null,

  // Queue review mode
  queueMode: false,
  queueIndex: 0,
  queueScreenshotIds: [],

  setActiveStage: (stage) => set({ activeStage: stage }),
  setPageMode: (mode) => set({ pageMode: mode }),
  setFilter: (filter) => set({ filter }),
  setSelectedGroupId: (groupId) => {
    set({ selectedGroupId: groupId, screenshots: [], summary: null });
    // Auto-load when group changes — catch to prevent unhandled rejections
    get().loadScreenshots().catch(() => {});
    get().loadSummary().catch(() => {});
  },
  setPhiPreset: (preset) => set({ phiPreset: preset }),
  setRedactionMethod: (method) => set({ redactionMethod: method }),
  setLlmEnabled: (enabled) => set({ llmEnabled: enabled }),
  setLlmEndpoint: (endpoint) => set({ llmEndpoint: endpoint }),
  setLlmModel: (model) => set({ llmModel: model }),

  loadGroups: async () => {
    try {
      const data = await service.getGroups();
      if (data && data.length > 0) {
        set({ groups: data });
        if (!get().selectedGroupId) {
          get().setSelectedGroupId(data[0]!.id);
        }
      }
    } catch (err) {
      console.error("Failed to load groups:", err);
      toast.error("Failed to load groups");
    }
  },

  loadScreenshots: async () => {
    const { selectedGroupId } = get();
    if (!selectedGroupId) {
      set({ screenshots: [] });
      return;
    }

    // Only show loading spinner on initial load, not background refreshes
    const isInitialLoad = get().screenshots.length === 0;
    if (isInitialLoad) set({ isLoading: true });
    try {
      const data = await service.getScreenshots({
        group_id: selectedGroupId,
        page_size: 5000,
        sort_by: "id",
        sort_order: "asc",
      });
      if (data) {
        // Avoid replacing the array reference if data hasn't changed —
        // this prevents downstream useMemo/re-renders from triggering.
        const prev = get().screenshots;
        const next = data.items;
        const changed = prev.length !== next.length ||
          next.some((item: any, i: number) =>
            item.id !== prev[i]?.id ||
            item.processing_status !== prev[i]?.processing_status ||
            item.processed_at !== prev[i]?.processed_at ||
            JSON.stringify((item.processing_metadata as any)?.preprocessing?.stage_status) !==
              JSON.stringify((prev[i]?.processing_metadata as any)?.preprocessing?.stage_status)
          );
        if (changed) {
          set({ screenshots: next });
        }
      }
    } catch (err) {
      console.error("Failed to load screenshots:", err);
      if (isInitialLoad) toast.error("Failed to load screenshots");
    } finally {
      if (isInitialLoad) set({ isLoading: false });
    }
  },

  loadSummary: async () => {
    const { selectedGroupId } = get();
    if (!selectedGroupId) return;

    try {
      const data = await service.getSummary(selectedGroupId);
      if (data) {
        set({ summary: data as PreprocessingSummaryData });

        // Auto-detect running tasks and start polling if not already polling
        const summaryData = data as PreprocessingSummaryData;
        const activeStage = get().activeStage;
        const stageSummary = summaryData[activeStage];
        const alreadyPolling = get()._pollInterval !== null;
        if (stageSummary && stageSummary.running > 0 && !alreadyPolling) {
          set({
            isRunningStage: true,
            stageProgress: { completed: 0, total: stageSummary.running },
            _pollCount: 0,
            _queuedCount: stageSummary.running,
            _completedBaseline: stageSummary.completed,
            _pollStage: activeStage,
          });
          get().startPolling();
        }
      }
    } catch (err) {
      console.error("Failed to load preprocessing summary:", err);
    }
  },

  runStage: async (stage, screenshotIds) => {
    const { selectedGroupId, phiPreset, redactionMethod, llmEnabled, llmEndpoint, llmModel } = get();
    if (!selectedGroupId && !screenshotIds) return;

    // Capture how many are already completed before this batch starts
    const summary = get().summary;
    const baseline = summary ? summary[stage]?.completed ?? 0 : 0;
    set({ isRunningStage: true, stageProgress: null, _pollCount: 0, _queuedCount: 0, _completedBaseline: baseline, _pollStage: stage });
    try {
      const options: {
        group_id?: string;
        screenshot_ids?: number[];
        phi_pipeline_preset?: string;
        phi_redaction_method?: string;
        llm_endpoint?: string;
        llm_model?: string;
      } = {
        group_id: selectedGroupId || undefined,
        screenshot_ids: screenshotIds,
        phi_pipeline_preset: phiPreset,
        phi_redaction_method: redactionMethod,
      };
      if (llmEnabled && stage === "phi_detection") {
        options.llm_endpoint = llmEndpoint;
        options.llm_model = llmModel;
      }
      const result = await service.runStage(stage, options);
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

  resetStage: async (stage) => {
    const { selectedGroupId } = get();
    if (!selectedGroupId) return;
    try {
      const result = await service.resetStage(stage, selectedGroupId);
      toast.success(result.message || `Stage ${stage.replace(/_/g, " ")} reset`);
      await get().loadScreenshots();
      await get().loadSummary();
    } catch (err) {
      console.error("Failed to reset stage:", err);
      toast.error("Failed to reset stage");
    }
  },

  invalidateFromStage: async (screenshotId, stage) => {
    try {
      await service.invalidateFromStage(screenshotId, stage);
      toast.success(`Downstream stages invalidated from ${stage.replace(/_/g, " ")}`);
      await get().loadScreenshots();
      await get().loadSummary();
    } catch (err) {
      console.error("Failed to invalidate:", err);
      toast.error("Failed to invalidate stages");
    }
  },

  loadEventLog: async (screenshotId) => {
    try {
      const data = await service.getEventLog(screenshotId);
      set({ selectedScreenshotId: screenshotId, eventLog: data as EventLogData });
    } catch (err) {
      console.error("Failed to load event log:", err);
      toast.error("Failed to load event log");
    }
  },

  clearEventLog: () => set({ selectedScreenshotId: null, eventLog: null }),

  // Upload actions
  setUploadFiles: (files) => set({ uploadFiles: files }),
  setUploadImageType: (type) => set({ uploadImageType: type }),
  setUploadGroupId: (groupId) => set({ uploadGroupId: groupId }),

  startBrowserUpload: async () => {
    const { uploadFiles, uploadGroupId, uploadImageType } = get();
    if (!uploadFiles.length || !uploadGroupId) return;

    set({ isUploading: true, uploadProgress: { completed: 0, total: uploadFiles.length }, uploadErrors: [] });

    const BATCH_SIZE = 60;
    const errors: string[] = [];
    let totalCompleted = 0;

    for (let batchStart = 0; batchStart < uploadFiles.length; batchStart += BATCH_SIZE) {
      const batch = uploadFiles.slice(batchStart, batchStart + BATCH_SIZE);
      const formData = new FormData();

      const metadata = {
        group_id: uploadGroupId,
        image_type: uploadImageType,
        items: batch.map((item) => ({
          participant_id: item.participant_id,
          filename: item.filename,
          original_filepath: item.original_filepath || null,
          screenshot_date: item.screenshot_date || null,
        })),
      };

      formData.append("metadata", JSON.stringify(metadata));
      for (const item of batch) {
        formData.append("files", item.file);
      }

      try {
        const result = await service.uploadBrowser(formData);
        totalCompleted += result.successful || 0;
        if (result.failed > 0) {
          for (const r of result.results || []) {
            if (!r.success && r.error) {
              errors.push(`File ${batchStart + r.index}: ${r.error}`);
            }
          }
        }
      } catch (err) {
        errors.push(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} failed: ${err}`);
      }

      set({ uploadProgress: { completed: totalCompleted, total: uploadFiles.length } });
    }

    set({ isUploading: false, uploadErrors: errors });

    if (errors.length === 0) {
      toast.success(`Uploaded ${totalCompleted} screenshot(s)`);
      // Clear upload state and switch to pipeline mode to show uploaded screenshots
      set({ uploadFiles: [], uploadProgress: null, pageMode: "pipeline" });
    } else {
      toast.error(`Upload completed with ${errors.length} error(s)`);
    }

    // Refresh groups and screenshots
    await get().loadGroups();
    if (uploadGroupId) {
      get().setSelectedGroupId(uploadGroupId);
    }
  },

  // Queue review actions
  enterQueue: (screenshotIds, startIndex = 0) =>
    set({ queueMode: true, queueScreenshotIds: screenshotIds, queueIndex: startIndex }),
  exitQueue: () =>
    set({ queueMode: false, queueIndex: 0, queueScreenshotIds: [] }),
  queueNext: () => {
    const { queueIndex, queueScreenshotIds } = get();
    if (queueIndex < queueScreenshotIds.length - 1) {
      set({ queueIndex: queueIndex + 1 });
    }
  },
  queuePrev: () => {
    const { queueIndex } = get();
    if (queueIndex > 0) {
      set({ queueIndex: queueIndex - 1 });
    }
  },
  queueGoTo: (index) => {
    const { queueScreenshotIds } = get();
    if (index >= 0 && index < queueScreenshotIds.length) {
      set({ queueIndex: index });
    }
  },

  // Deep-link actions
  setHighlightedScreenshotId: (id) => set({ highlightedScreenshotId: id }),
  setReturnUrl: (url) => set({ returnUrl: url }),

  startPolling: () => {
    const existing = get()._pollInterval;
    if (existing) clearInterval(existing);

    const interval = setInterval(async () => {
      set({ _pollCount: get()._pollCount + 1 });
      await Promise.all([get().loadSummary(), get().loadScreenshots()]);
      const summary = get().summary;
      if (summary) {
        const stage = get()._pollStage;
        const stageSummary = summary[stage];
        const pollCount = get()._pollCount;
        const queuedCount = get()._queuedCount;
        const baseline = get()._completedBaseline;
        // How many from THIS batch have completed (subtract pre-existing completed)
        const completedSoFar = stageSummary ? stageSummary.completed : 0;
        const batchCompleted = Math.max(0, completedSoFar - baseline);
        // Wait at least 3 polls (6s) before concluding "done" to give
        // Celery workers time to pick up tasks and set status to "running"
        const minPollsBeforeComplete = 3;
        const allDone = stageSummary &&
          stageSummary.running === 0 &&
          pollCount >= minPollsBeforeComplete &&
          // Only stop if completed count actually increased from the queued batch,
          // or if there's truly nothing pending/running for this stage
          (stageSummary.pending === 0 || batchCompleted >= queuedCount);
        if (allDone) {
          // Done — refresh everything and stop polling
          get().stopPolling();
          set({ isRunningStage: false, stageProgress: null });
        } else if (stageSummary) {
          set({
            stageProgress: {
              completed: batchCompleted,
              total: queuedCount || summary.total,
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
      if (result.reviewed) return false; // Manually reviewed — no longer needs review
      if (result.phi_detected) return true;
      if ((result.regions_count as number) > 10) return true;
    } else if (stage === "phi_redaction") {
      if (result.phi_detected && !result.redacted) return true;
    }
    return false;
  },

  getEligibleCount: (stage) => {
    const { screenshots } = get();
    const stageIdx = STAGES.indexOf(stage);
    const prereqs = STAGES.slice(0, stageIdx);
    let eligible = 0;
    let blockedByPrereq = 0;
    for (const s of screenshots) {
      const pp = (s.processing_metadata as Record<string, unknown>)?.preprocessing as Record<string, unknown> | undefined;
      const statuses = (pp?.stage_status as Record<string, string>) ?? {};
      const thisStatus = statuses[stage] ?? "pending";
      if (thisStatus !== "pending" && thisStatus !== "invalidated" && thisStatus !== "failed") continue;
      // Check prerequisites
      const prereqsMet = prereqs.every((p) => statuses[p] === "completed");
      if (prereqsMet) {
        eligible++;
      } else {
        blockedByPrereq++;
      }
    }
    return { eligible, blockedByPrereq };
  },
}));
}

export type { Stage, StageStatus, FilterMode, PageMode, StageSummary, PreprocessingSummaryData, PreprocessingEventData, EventLogData, UploadFileItem, PreprocessingState };
export { STAGES };
