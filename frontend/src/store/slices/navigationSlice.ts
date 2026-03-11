import type { StateCreator } from "zustand";
import type {
  IScreenshotService,
  IAnnotationService,
  ScreenshotListParams,
  NavigationParams,
} from "@/core";
import type { ProcessingStatus } from "@/types";
import type {
  AnnotationState,
  NavigationSlice,
  VerificationFilterType,
} from "./types";
import { filterToApiParams, extractGridCoords, extractErrorMessage } from "./helpers";

export const createNavigationSlice = (
  screenshotService: IScreenshotService,
  annotationService: IAnnotationService,
  groupId?: string,
  processingStatus?: ProcessingStatus,
): StateCreator<AnnotationState, [], [], NavigationSlice> => {
  // Per-instance guard — prevents concurrent loadMore calls without blocking other store instances
  let loadingMoreInProgress = false;
  // Stores the last params used by loadScreenshotList so loadMore can replay them (including search)
  let lastListParams: ScreenshotListParams = {};
  // Incremented each time loadScreenshotList resets the list; loadMore checks this to discard stale results
  let listGeneration = 0;

  return (set, get) => ({
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
        processing_status: processingStatus,
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
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "Failed to navigate");
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
        processing_status: processingStatus,
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
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "Failed to navigate");
      set({ error: message, isLoading: false });
    }
  },

  loadScreenshotList: async (params?: ScreenshotListParams) => {
    try {
      const listParams: ScreenshotListParams = {
        group_id: groupId,
        processing_status: processingStatus,
        ...filterToApiParams(get().verificationFilter),
        page_size: 100,
        sort_by: "id",
        sort_order: "asc",
        ...params,
      };

      lastListParams = listParams;
      listGeneration++;
      const result = await screenshotService.getList(listParams);
      set({
        screenshotList: result,
        totalInFilter: result.total,
      });
    } catch (error) {
      console.error("Failed to load screenshot list:", error);
    }
  },

  loadMoreScreenshots: async () => {
    const { screenshotList } = get();
    if (!screenshotList || !screenshotList.has_next || loadingMoreInProgress) return;

    loadingMoreInProgress = true;
    const nextPage = screenshotList.page + 1;
    const generationAtStart = listGeneration;
    try {
      const result = await screenshotService.getList({
        ...lastListParams,
        page: nextPage,
      });

      // If loadScreenshotList was called while we were fetching, discard stale results
      if (generationAtStart !== listGeneration) return;

      // Re-read current list to avoid overwriting changes made during the await
      const currentList = get().screenshotList;
      const existingItems = currentList?.items ?? [];

      // Deduplicate — items can shift between pages if status changes during pagination
      const existingIds = new Set(existingItems.map((s) => s.id));
      const newItems = result.items.filter((s) => !existingIds.has(s.id));

      set({
        screenshotList: {
          ...result,
          items: [...existingItems, ...newItems],
        },
      });
    } catch (error) {
      console.error("Failed to load more screenshots:", error);
    } finally {
      loadingMoreInProgress = false;
    }
  },

  setVerificationFilter: async (value: VerificationFilterType) => {
    set({ verificationFilter: value });

    // Reload the list with new filter and reload first screenshot
    try {
      await get().loadScreenshotList();
      const { screenshotList } = get();
      if (
        screenshotList &&
        screenshotList.items &&
        screenshotList.items.length > 0
      ) {
        await get().loadScreenshot(screenshotList.items[0]!.id);
      } else {
        set({ noScreenshots: true, currentScreenshot: null });
      }
    } catch (error) {
      console.error("Failed to apply verification filter:", error);
    }
  },

  verifyCurrentScreenshot: async () => {
    const { currentScreenshot, currentAnnotation, verificationFilter } = get();
    if (!currentScreenshot) return;

    const editedTitle = currentScreenshot.extracted_title;

    const gridCoords = currentAnnotation?.grid_coords || extractGridCoords(currentScreenshot);

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
        grid_upper_left: gridCoords?.upper_left ?? null,
        grid_lower_right: gridCoords?.lower_right ?? null,
      });

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
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "Failed to verify screenshot");
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
    } catch (error: unknown) {
      const message = extractErrorMessage(error, "Failed to unverify screenshot");
      set({ error: message });
    }
  },
});
};
