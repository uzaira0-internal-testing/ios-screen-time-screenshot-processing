import type { StateCreator } from "zustand";
import type { IScreenshotService, NavigationParams, ProcessingIssue, Screenshot } from "@/core";
import type { ProcessingStatus } from "@/types";
import type { AnnotationState, ScreenshotSlice, UIAnnotation } from "./types";
import { initialAnnotation } from "./types";
import { extractGridCoords, filterToApiParams, isVerifiedByCurrentUser, extractErrorMessage, extractErrorStatus } from "./helpers";

export const createScreenshotSlice = (
  screenshotService: IScreenshotService,
  groupId?: string,
  processingStatus?: ProcessingStatus,
): StateCreator<AnnotationState, [], [], ScreenshotSlice> => (set, get) => ({
  // State
  currentScreenshot: null,
  isLoading: false,
  noScreenshots: false,
  error: null,
  queueStats: null,

  // Actions
  loadNextScreenshot: async () => {
    set({ isLoading: true, error: null, noScreenshots: false });
    try {
      const screenshot = await screenshotService.getNext(
        groupId,
        processingStatus,
      );

      if (!screenshot || !screenshot.id) {
        set({
          currentScreenshot: null,
          noScreenshots: true,
          isLoading: false,
          processingIssues: [],
          isAutoProcessed: false,
        });
        return;
      }

      const prefilledAnnotation: UIAnnotation = {
        ...initialAnnotation,
      };
      let processingIssues: ProcessingIssue[] = [];
      let isAutoProcessed = false;

      if (screenshot.extracted_hourly_data) {
        prefilledAnnotation.hourly_values = screenshot.extracted_hourly_data;
        isAutoProcessed = true;
      }

      const gridCoords = extractGridCoords(screenshot);
      if (gridCoords) {
        prefilledAnnotation.grid_coords = gridCoords;
      }

      if (
        screenshot.processing_issues &&
        screenshot.processing_issues.length > 0
      ) {
        processingIssues = screenshot.processing_issues;
      }

      // Skip processing if THIS USER has already verified - their work is frozen
      const isVerifiedByMe = isVerifiedByCurrentUser(screenshot);

      let processedScreenshot = screenshot;

      if (!isVerifiedByMe) {
        // Process if needed (extracts title/total if missing) - only for unverified
        processedScreenshot =
          await screenshotService.processIfNeeded(screenshot);

        // Update prefilled annotation with any newly processed data
        if (
          processedScreenshot.extracted_hourly_data &&
          !prefilledAnnotation.hourly_values
        ) {
          prefilledAnnotation.hourly_values =
            processedScreenshot.extracted_hourly_data;
          isAutoProcessed = true;
        }

        // Only set grid coords if not already set (check for undefined, not falsy - x:0 is valid)
        if (
          prefilledAnnotation.grid_coords?.upper_left?.x === undefined
        ) {
          const coords = extractGridCoords(processedScreenshot);
          if (coords) {
            prefilledAnnotation.grid_coords = coords;
          }
        }
      }

      set({
        currentScreenshot: processedScreenshot,
        currentAnnotation: prefilledAnnotation,
        consensus: null,
        noScreenshots: false,
        isLoading: false,
        processingIssues,
        isAutoProcessed,
      });

      // Initialize navigation state for the first loaded screenshot
      const { screenshotList, verificationFilter } = get();
      if (screenshotList && screenshotList.items.length > 0) {
        const currentIdx = screenshotList.items.findIndex(
          (s: Screenshot) => s.id === processedScreenshot.id,
        );
        if (currentIdx !== -1) {
          set({
            currentIndex: currentIdx + 1,
            totalInFilter: screenshotList.total,
            hasPrev: currentIdx > 0,
            hasNext: currentIdx < screenshotList.items.length - 1,
          });
        }
      } else {
        // Fetch navigation state from server if list not loaded
        try {
          const navParams: NavigationParams = {
            group_id: groupId,
            processing_status: processingStatus,
            ...filterToApiParams(verificationFilter),
            direction: "current", // Just get position info, don't navigate
          };
          const navResult = await screenshotService.navigate(
            processedScreenshot.id,
            navParams,
          );
          set({
            currentIndex: navResult.current_index,
            totalInFilter: navResult.total_in_filter,
            hasNext: navResult.has_next,
            hasPrev: navResult.has_prev,
          });
        } catch (navError) {
          console.warn("Failed to fetch navigation state:", navError);
        }
      }

      if (processedScreenshot.current_annotation_count > 0) {
        await get().loadConsensus(processedScreenshot.id);
      }
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "Failed to load screenshot");
      const status = extractErrorStatus(error);
      if (
        message.includes("No screenshots") ||
        status === 404
      ) {
        set({ noScreenshots: true, isLoading: false, error: null });
        return;
      }
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  loadScreenshot: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      const screenshot = await screenshotService.getById(id);

      const prefilledAnnotation: UIAnnotation = {
        ...initialAnnotation,
      };
      let processingIssues: ProcessingIssue[] = [];
      let isAutoProcessed = false;

      if (screenshot.extracted_hourly_data) {
        prefilledAnnotation.hourly_values = screenshot.extracted_hourly_data;
        isAutoProcessed = true;
      }

      const gridCoords = extractGridCoords(screenshot);
      if (gridCoords) {
        prefilledAnnotation.grid_coords = gridCoords;
      }

      if (
        screenshot.processing_issues &&
        screenshot.processing_issues.length > 0
      ) {
        processingIssues = screenshot.processing_issues;
      }

      set({
        currentScreenshot: screenshot,
        currentAnnotation: prefilledAnnotation,
        consensus: null,
        isLoading: false,
        processingIssues,
        isAutoProcessed,
      });

      // Update navigation state based on current screenshot position in list
      const { screenshotList, verificationFilter } = get();
      if (screenshotList && screenshotList.items.length > 0) {
        const currentIdx = screenshotList.items.findIndex(
          (s: Screenshot) => s.id === screenshot.id,
        );
        if (currentIdx !== -1) {
          set({
            currentIndex: currentIdx + 1,
            totalInFilter: screenshotList.total,
            hasPrev: currentIdx > 0,
            hasNext: currentIdx < screenshotList.items.length - 1,
          });
        }
      } else {
        // If no list loaded yet, fetch navigation state from server
        try {
          const navParams: NavigationParams = {
            group_id: groupId,
            processing_status: processingStatus,
            ...filterToApiParams(verificationFilter),
            direction: "current", // Just get position info, don't navigate
          };
          const navResult = await screenshotService.navigate(id, navParams);
          set({
            currentIndex: navResult.current_index,
            totalInFilter: navResult.total_in_filter,
            hasNext: navResult.has_next,
            hasPrev: navResult.has_prev,
          });
        } catch (navError) {
          console.warn("Failed to fetch navigation state:", navError);
        }
      }

      if (screenshot.current_annotation_count > 0) {
        await get().loadConsensus(screenshot.id);
      }
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "Failed to load screenshot");
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  loadQueueStats: async () => {
    try {
      const stats = await screenshotService.getStats();
      set({ queueStats: stats });
    } catch (error) {
      console.error("Failed to load queue stats:", error);
    }
  },

  skipScreenshot: async () => {
    const { currentScreenshot } = get();
    if (currentScreenshot) {
      await screenshotService.skip(currentScreenshot.id);
    }
    // Use navigateNext to go to the next screenshot in the queue (like pressing "next")
    // instead of loadNextScreenshot which resets to the beginning
    await get().navigateNext();
  },
});
