import type { StateCreator } from "zustand";
import type {
  IScreenshotService,
  IAnnotationService,
  ScreenshotListParams,
  NavigationParams,
} from "@/core";
import type {
  AnnotationState,
  NavigationSlice,
  VerificationFilterType,
} from "./types";
import { filterToApiParams } from "./helpers";

export const createNavigationSlice = (
  screenshotService: IScreenshotService,
  annotationService: IAnnotationService,
  groupId?: string,
  processingStatus?: string,
): StateCreator<AnnotationState, [], [], NavigationSlice> => (set, get) => ({
  // State
  currentIndex: 0,
  totalInFilter: 0,
  hasNext: false,
  hasPrev: false,
  screenshotList: null,
  verificationFilter: "all",

  // Actions
  navigateNext: async () => {
    const { currentScreenshot, verificationFilter } = get();
    if (!currentScreenshot) return;

    set({ isLoading: true, error: null });
    try {
      const navParams: NavigationParams = {
        group_id: groupId,
        processing_status: processingStatus as any,
        ...filterToApiParams(verificationFilter),
        direction: "next",
      };

      const result = await screenshotService.navigate(
        currentScreenshot.id,
        navParams,
      );

      if (result.screenshot) {
        await get().loadScreenshot(result.screenshot.id);
        set({
          currentIndex: result.current_index,
          totalInFilter: result.total_in_filter,
          hasNext: result.has_next,
          hasPrev: result.has_prev,
        });
      } else {
        set({ noScreenshots: true, isLoading: false });
      }
    } catch (error: any) {
      const message =
        error.response?.data?.detail || error.message || "Failed to navigate";
      set({ error: message, isLoading: false });
    }
  },

  navigatePrev: async () => {
    const { currentScreenshot, verificationFilter } = get();
    if (!currentScreenshot) return;

    set({ isLoading: true, error: null });
    try {
      const navParams: NavigationParams = {
        group_id: groupId,
        processing_status: processingStatus as any,
        ...filterToApiParams(verificationFilter),
        direction: "prev",
      };

      const result = await screenshotService.navigate(
        currentScreenshot.id,
        navParams,
      );

      if (result.screenshot) {
        await get().loadScreenshot(result.screenshot.id);
        set({
          currentIndex: result.current_index,
          totalInFilter: result.total_in_filter,
          hasNext: result.has_next,
          hasPrev: result.has_prev,
        });
      }
    } catch (error: any) {
      const message =
        error.response?.data?.detail || error.message || "Failed to navigate";
      set({ error: message, isLoading: false });
    }
  },

  loadScreenshotList: async (params?: ScreenshotListParams) => {
    try {
      const listParams: ScreenshotListParams = {
        group_id: groupId,
        processing_status: processingStatus as any,
        ...filterToApiParams(get().verificationFilter),
        page_size: 5000,
        sort_by: "id",
        sort_order: "asc",
        ...params,
      };

      const result = await screenshotService.getList(listParams);
      set({
        screenshotList: result,
        totalInFilter: result.total,
      });
    } catch (error) {
      console.error("Failed to load screenshot list:", error);
    }
  },

  setVerificationFilter: (value: VerificationFilterType) => {
    set({ verificationFilter: value });

    // Reload the list with new filter and reload first screenshot
    get()
      .loadScreenshotList()
      .then(() => {
        const { screenshotList } = get();
        if (
          screenshotList &&
          screenshotList.items &&
          screenshotList.items.length > 0
        ) {
          get().loadScreenshot(screenshotList.items[0]!.id);
        } else {
          set({ noScreenshots: true, currentScreenshot: null });
        }
      });
  },

  verifyCurrentScreenshot: async () => {
    const { currentScreenshot, currentAnnotation, verificationFilter } = get();
    if (!currentScreenshot) return;

    const editedTitle = currentScreenshot.extracted_title;

    const gridCoords = currentAnnotation?.grid_coords || (
      currentScreenshot.grid_upper_left_x != null &&
      currentScreenshot.grid_upper_left_y != null &&
      currentScreenshot.grid_lower_right_x != null &&
      currentScreenshot.grid_lower_right_y != null ? {
        upper_left: { x: currentScreenshot.grid_upper_left_x, y: currentScreenshot.grid_upper_left_y },
        lower_right: { x: currentScreenshot.grid_lower_right_x, y: currentScreenshot.grid_lower_right_y },
      } : undefined
    );

    const hourlyValues = currentAnnotation?.hourly_values || currentScreenshot.extracted_hourly_data || {};

    try {
      if (editedTitle !== undefined && editedTitle !== null) {
        await screenshotService.updateTitle(currentScreenshot.id, editedTitle);
      }

      if (Object.keys(hourlyValues).length > 0) {
        await screenshotService.updateHourlyData(currentScreenshot.id, hourlyValues);
      }

      await annotationService.create({
        screenshot_id: currentScreenshot.id,
        hourly_values: hourlyValues,
        extracted_title: editedTitle || null,
        extracted_total: currentScreenshot.extracted_total || null,
        grid_upper_left: gridCoords?.upper_left,
        grid_lower_right: gridCoords?.lower_right,
      } as any);

      const updatedScreenshot = await screenshotService.verify(
        currentScreenshot.id,
        gridCoords,
      );

      const newScreenshot = {
        ...updatedScreenshot,
        extracted_title: editedTitle,
      };

      set({ currentScreenshot: newScreenshot });

      const { screenshotList } = get();
      if (screenshotList) {
        await get().loadScreenshotList();
      }

      // If filtering by "not verified by me", navigate to next since this one is now verified
      if (verificationFilter === "not_verified_by_me") {
        await get().navigateNext();
      }
    } catch (error: any) {
      const message =
        error.response?.data?.detail ||
        error.message ||
        "Failed to verify screenshot";
      set({ error: message });
    }
  },

  unverifyCurrentScreenshot: async () => {
    const { currentScreenshot, verificationFilter } = get();
    if (!currentScreenshot) return;

    try {
      const updatedScreenshot = await screenshotService.unverify(currentScreenshot.id);
      set({ currentScreenshot: updatedScreenshot });

      const { screenshotList } = get();
      if (screenshotList) {
        await get().loadScreenshotList();
      }

      // If filtering by "verified by me", navigate to next since this one is no longer verified
      if (verificationFilter === "verified_by_me") {
        await get().navigateNext();
      }
    } catch (error: any) {
      const message =
        error.response?.data?.detail ||
        error.message ||
        "Failed to unverify screenshot";
      set({ error: message });
    }
  },
});
