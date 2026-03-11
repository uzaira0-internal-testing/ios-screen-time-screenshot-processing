import type { StateCreator } from "zustand";
import type {
  IAnnotationService,
  IScreenshotService,
  IConsensusService,
  GridCoordinates,
  HourlyData,
} from "@/core";
import type { AnnotationState, AnnotationSlice } from "./types";
import { initialAnnotation } from "./types";
import { extractErrorMessage } from "./helpers";

export const createAnnotationSlice = (
  screenshotService: IScreenshotService,
  annotationService: IAnnotationService,
  consensusService: IConsensusService,
): StateCreator<AnnotationState, [], [], AnnotationSlice> => (set, get) => ({
  // State
  currentAnnotation: { ...initialAnnotation },
  processingIssues: [],
  isAutoProcessed: false,
  consensus: null,

  // Actions
  setGridCoordinates: (coords: GridCoordinates) => {
    set((state) => ({
      currentAnnotation: {
        ...state.currentAnnotation,
        grid_coords: coords,
      },
    }));
  },

  setHourlyValues: (data: HourlyData) => {
    set((state) => ({
      currentAnnotation: {
        ...state.currentAnnotation,
        hourly_values: data,
      },
    }));
  },

  updateHourValue: (hour: number, value: number) => {
    set((state) => {
      const hourlyData = { ...state.currentAnnotation?.hourly_values };
      if (value < 0 || value > 60) return state;

      hourlyData[hour] = value;

      return {
        currentAnnotation: {
          ...state.currentAnnotation,
          hourly_values: hourlyData,
        },
      };
    });
  },

  setExtractedTitle: (title: string) => {
    set((state) => {
      if (!state.currentScreenshot) return state;
      return {
        currentScreenshot: {
          ...state.currentScreenshot,
          extracted_title: title,
        },
      };
    });
  },

  saveAnnotation: async (notes?: string) => {
    const { currentScreenshot, currentAnnotation } = get();

    if (!currentScreenshot || !currentAnnotation?.grid_coords) {
      throw new Error("Missing required data");
    }

    set({ isLoading: true, error: null });
    try {
      // Convert UIAnnotation to AnnotationCreate format for the API
      await annotationService.create({
        screenshot_id: currentScreenshot.id,
        hourly_values: currentAnnotation.hourly_values || {},
        grid_upper_left: currentAnnotation.grid_coords.upper_left,
        grid_lower_right: currentAnnotation.grid_coords.lower_right,
        notes: notes || currentAnnotation.notes || null,
      });

      // Also save the title to the screenshot if it was edited
      if (currentScreenshot.extracted_title !== undefined) {
        await screenshotService.updateTitle(
          currentScreenshot.id,
          currentScreenshot.extracted_title || "",
        );
      }

      // Also save the hourly data directly to the screenshot
      // This ensures manual edits persist when loading the screenshot later
      if (currentAnnotation.hourly_values) {
        await screenshotService.updateHourlyData(
          currentScreenshot.id,
          currentAnnotation.hourly_values,
        );
      }

      set({ isLoading: false });
      await get().loadQueueStats();
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "Failed to save annotation");
      set({ error: message, isLoading: false });
      throw error;
    }
  },

  loadConsensus: async (screenshotId: number) => {
    try {
      const consensus = await consensusService.getForScreenshot(screenshotId);
      set({ consensus });
    } catch (error) {
      console.error("Failed to load consensus:", error);
    }
  },
});
