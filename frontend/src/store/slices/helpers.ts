import type { Screenshot, NavigationParams } from "@/core";
import type { VerificationFilterType } from "./types";
import { useAuthStore } from "../authStore";

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
