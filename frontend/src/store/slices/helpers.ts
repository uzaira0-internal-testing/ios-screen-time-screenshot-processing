import type { Screenshot, NavigationParams, GridCoordinates } from "@/core";
import type { VerificationFilterType } from "./types";
import { useAuthStore } from "../authStore";

/** Any object with the 4 flat grid coordinate fields. */
type HasGridFields = {
  grid_upper_left_x?: number | null;
  grid_upper_left_y?: number | null;
  grid_lower_right_x?: number | null;
  grid_lower_right_y?: number | null;
};

/**
 * Extract grid coordinates from flat fields into a GridCoordinates object.
 * Returns undefined if upper_left_x or lower_right_x are null/undefined.
 */
export function extractGridCoords(obj: HasGridFields): GridCoordinates | undefined {
  if (obj.grid_upper_left_x == null || obj.grid_lower_right_x == null) {
    return undefined;
  }
  return {
    upper_left: {
      x: obj.grid_upper_left_x,
      y: obj.grid_upper_left_y ?? 0,
    },
    lower_right: {
      x: obj.grid_lower_right_x,
      y: obj.grid_lower_right_y ?? 0,
    },
  };
}

/**
 * Check if current user has verified a screenshot.
 * Both userId and verified_by_user_ids are typed as numbers.
 */
export const isVerifiedByCurrentUser = (
  screenshot: Screenshot | null,
): boolean => {
  if (!screenshot?.verified_by_user_ids) return false;
  const userId = useAuthStore.getState().userId;
  if (userId === null) return false;
  return screenshot.verified_by_user_ids.includes(userId);
};

/**
 * Convert a VerificationFilterType to API query parameters.
 * Centralizes filter-to-API conversion to avoid duplication.
 */
export function filterToApiParams(
  filter: VerificationFilterType,
): Pick<NavigationParams, "verified_by_me" | "verified_by_others"> {
  switch (filter) {
    case "verified_by_me":
      return { verified_by_me: true };
    case "not_verified_by_me":
      return { verified_by_me: false };
    case "verified_by_others":
      return { verified_by_others: true };
    case "all":
    default:
      return {};
  }
}
