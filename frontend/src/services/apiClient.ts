/**
 * Type-safe API client using openapi-fetch
 * Auto-generated types from OpenAPI schema ensure compile-time type safety
 *
 * IMPORTANT: All types come from the Pydantic schemas via OpenAPI generation.
 * DO NOT define duplicate types here - use components["schemas"]["TypeName"] instead.
 */

import createClient from "openapi-fetch";
import type { paths, components } from "@/types/api-schema";
import { config } from "@/config";

// Re-export types from OpenAPI schema for convenience
export type GroupVerificationSummary = components["schemas"]["GroupVerificationSummary"];
export type ScreenshotTierItem = components["schemas"]["ScreenshotTierItem"];
export type ScreenshotComparison = components["schemas"]["ScreenshotComparison"];
export type VerifierAnnotation = components["schemas"]["VerifierAnnotation"];
export type FieldDifference = components["schemas"]["FieldDifference"];
export type DeleteGroupResponse = components["schemas"]["DeleteGroupResponse"];
export type ResolveDisputeResponse = components["schemas"]["ResolveDisputeResponse"];

// OpenAPI paths in the generated schema already include "/api/v1" prefix
// (e.g., "/api/v1/auth/login", "/api/v1/screenshots/next")
// Therefore, baseUrl should be the app prefix only (e.g., "/screenshot").
//
// config.basePath is the app prefix (e.g., "/ios-screen-time-screenshot-processing")
// config.apiBaseUrl is the full API path (e.g., "/ios-screen-time-screenshot-processing/api/v1")
const API_BASE_URL = config.basePath;

// For image URLs that need the full prefix
const LEGACY_API_PREFIX = config.apiBaseUrl;

// Create type-safe client
export const apiClient = createClient<paths>({ baseUrl: API_BASE_URL });

// Add request interceptor for authentication
// Sends both X-Username and X-Site-Password headers on all requests
apiClient.use({
  onRequest({ request }) {
    const username = localStorage.getItem("username");
    if (username) {
      request.headers.set("X-Username", username);
    }

    const sitePassword = localStorage.getItem("sitePassword");
    if (sitePassword) {
      request.headers.set("X-Site-Password", sitePassword);
    }

    // Debug logging (will appear in browser console)
    if (config.isDev) {
      console.log("[apiClient] Request:", request.url, {
        hasUsername: !!username,
        hasSitePassword: !!sitePassword,
      });
    }

    return request;
  },
  onResponse({ response }) {
    // Handle 401 responses by clearing auth state
    // Only logout if not already on login page (prevents redirect loops)
    // and if we're not checking auth status (prevents logout during initial auth check)
    if (response.status === 401) {
      const isLoginPage = window.location.pathname.endsWith("/login");
      const isAuthStatusCheck = response.url.includes("/auth/status");

      if (!isLoginPage && !isAuthStatusCheck) {
        console.warn("[apiClient] 401 response - logging out user");
        // Import dynamically to avoid circular dependency
        import("@/store/authStore").then(({ useAuthStore }) => {
          useAuthStore.getState().logout();
        });
      }
    }
    return response;
  },
});

/**
 * Helper function to throw errors with backend detail messages
 */
function throwIfError(
  error: unknown,
  defaultMessage: string,
): asserts error is undefined {
  if (error) {
    const detail = (error as any)?.detail || defaultMessage;
    throw new Error(detail);
  }
}

/**
 * Type-safe API wrapper functions
 * These provide a clean interface for the application
 */
export const api = {
  // Authentication
  auth: {
    async isPasswordRequired(): Promise<boolean> {
      const { data, error } = await apiClient.GET("/api/v1/auth/status");
      if (error) {
        console.warn("Failed to check password requirement:", error);
        return false;
      }
      return data?.password_required ?? false;
    },

    async login(username: string, password?: string) {
      const { data, error } = await apiClient.POST("/api/v1/auth/login", {
        body: { username, password: password || null },
      });
      throwIfError(error, "Login failed");
      return data;
    },

    async getMe() {
      const { data, error } = await apiClient.GET("/api/v1/auth/me");
      throwIfError(error, "Failed to get current user");
      return data;
    },
  },

  // Screenshots
  screenshots: {
    async getNext(params?: { group?: string; processing_status?: string }) {
      const { data, error } = await apiClient.GET("/api/v1/screenshots/next", {
        params: { query: params },
      });
      throwIfError(error, "Failed to get next screenshot");
      return data;
    },

    async getById(id: number) {
      const { data, error } = await apiClient.GET(
        "/api/v1/screenshots/{screenshot_id}",
        {
          params: { path: { screenshot_id: id } },
        },
      );
      throwIfError(error, "Failed to get screenshot");
      return data;
    },

    async getStats() {
      const { data, error } = await apiClient.GET("/api/v1/screenshots/stats");
      throwIfError(error, "Failed to get stats");
      return data;
    },

    async list(params?: {
      page?: number;
      page_size?: number;
      group_id?: string;
      processing_status?: string;
      verified_by_me?: boolean;
      search?: string;
      sort_by?: string;
      sort_order?: string;
    }) {
      const { data, error } = await apiClient.GET("/api/v1/screenshots/list", {
        params: { query: params },
      });
      throwIfError(error, "Failed to list screenshots");
      return data;
    },

    async skip(id: number) {
      const { error } = await apiClient.POST(
        "/api/v1/screenshots/{screenshot_id}/skip",
        {
          params: { path: { screenshot_id: id } },
        },
      );
      throwIfError(error, "Failed to skip screenshot");
    },

    async verify(id: number) {
      const { data, error } = await apiClient.POST(
        "/api/v1/screenshots/{screenshot_id}/verify",
        {
          params: { path: { screenshot_id: id } },
        },
      );
      throwIfError(error, "Failed to verify screenshot");
      return data;
    },

    async unverify(id: number) {
      const { data, error } = await apiClient.DELETE(
        "/api/v1/screenshots/{screenshot_id}/verify",
        {
          params: { path: { screenshot_id: id } },
        },
      );
      throwIfError(error, "Failed to unverify screenshot");
      return data;
    },

    async getImageUrl(id: number): Promise<string> {
      return `${LEGACY_API_PREFIX}/screenshots/${id}/image`;
    },

    async reprocess(
      id: number,
      options?: {
        grid_upper_left_x?: number;
        grid_upper_left_y?: number;
        grid_lower_right_x?: number;
        grid_lower_right_y?: number;
        processing_method?: "ocr_anchored" | "line_based";
        max_shift?: number;
      },
    ) {
      const { data, error } = await apiClient.POST(
        "/api/v1/screenshots/{screenshot_id}/reprocess",
        {
          params: { path: { screenshot_id: id } },
          body: { max_shift: 5, ...options },
        },
      );
      throwIfError(error, "Failed to reprocess screenshot");
      return data;
    },

    async navigate(
      id: number,
      params: {
        group_id?: string;
        processing_status?: string;
        verified_by_me?: boolean;
        verified_by_others?: boolean;
        direction?: "next" | "prev" | "current";
      },
    ) {
      const { data, error } = await apiClient.GET(
        "/api/v1/screenshots/{screenshot_id}/navigate",
        {
          params: {
            path: { screenshot_id: id },
            query: params,
          },
        },
      );
      throwIfError(error, "Failed to navigate screenshots");
      return data;
    },

    async update(
      id: number,
      updates: {
        extracted_title?: string | null;
        extracted_hourly_data?: Record<string, number> | null;
      },
    ) {
      const { data, error } = await apiClient.PATCH(
        "/api/v1/screenshots/{screenshot_id}",
        {
          params: { path: { screenshot_id: id } },
          body: updates,
        },
      );
      throwIfError(error, "Failed to update screenshot");
      return data;
    },

    async recalculateOcr(id: number) {
      const { data, error } = await apiClient.POST(
        "/api/v1/screenshots/{screenshot_id}/recalculate-ocr",
        {
          params: { path: { screenshot_id: id } },
        },
      );
      throwIfError(error, "Failed to recalculate OCR");
      return data;
    },
  },

  // Annotations
  annotations: {
    async create(annotation: {
      screenshot_id: number;
      hourly_values: Record<string, any>;
      extracted_title?: string;
      extracted_total?: string;
      grid_upper_left?: { x: number; y: number };
      grid_lower_right?: { x: number; y: number };
      time_spent_seconds?: number;
      notes?: string;
    }) {
      const { data, error } = await apiClient.POST("/api/v1/annotations/", {
        body: annotation,
      });
      throwIfError(error, "Failed to create annotation");
      return data;
    },

    async getHistory(params?: { skip?: number; limit?: number }) {
      const { data, error } = await apiClient.GET(
        "/api/v1/annotations/history",
        {
          params: { query: params },
        },
      );
      throwIfError(error, "Failed to get annotation history");
      return data;
    },

    async delete(id: number) {
      const { error } = await apiClient.DELETE(
        "/api/v1/annotations/{annotation_id}",
        {
          params: { path: { annotation_id: id } },
        },
      );
      throwIfError(error, "Failed to delete annotation");
    },
  },

  // Consensus
  consensus: {
    async getForScreenshot(id: number) {
      const { data, error } = await apiClient.GET(
        "/api/v1/consensus/{screenshot_id}",
        {
          params: { path: { screenshot_id: id } },
        },
      );
      throwIfError(error, "Failed to get consensus");
      return data;
    },

    async getSummary() {
      const { data, error } = await apiClient.GET(
        "/api/v1/consensus/summary/stats",
      );
      throwIfError(error, "Failed to get consensus summary");
      return data;
    },

    // Verification tier endpoints - using typed apiClient
    async getGroupsWithTiers(): Promise<GroupVerificationSummary[]> {
      const { data, error } = await apiClient.GET("/api/v1/consensus/groups");
      throwIfError(error, "Failed to get groups with verification tiers");
      return data!;
    },

    async getScreenshotsByTier(
      groupId: string,
      tier: "single_verified" | "agreed" | "disputed",
    ): Promise<ScreenshotTierItem[]> {
      const { data, error } = await apiClient.GET(
        "/api/v1/consensus/groups/{group_id}/screenshots",
        {
          params: {
            path: { group_id: groupId },
            query: { tier },
          },
        },
      );
      throwIfError(error, "Failed to get screenshots by tier");
      return data!;
    },

    async getScreenshotComparison(
      screenshotId: number,
    ): Promise<ScreenshotComparison> {
      const { data, error } = await apiClient.GET(
        "/api/v1/consensus/screenshots/{screenshot_id}/compare",
        {
          params: { path: { screenshot_id: screenshotId } },
        },
      );
      throwIfError(error, "Failed to get screenshot comparison");
      return data!;
    },

    async resolveDispute(
      screenshotId: number,
      resolution: {
        hourly_values: Record<string, number>;
        extracted_title?: string;
        extracted_total?: string;
        resolution_notes?: string;
      },
    ): Promise<ResolveDisputeResponse> {
      const { data, error } = await apiClient.POST(
        "/api/v1/consensus/screenshots/{screenshot_id}/resolve",
        {
          params: { path: { screenshot_id: screenshotId } },
          body: resolution,
        },
      );
      throwIfError(error, "Failed to resolve dispute");
      return data!;
    },
  },

  // Groups
  groups: {
    async list() {
      const { data, error } = await apiClient.GET("/api/v1/screenshots/groups");
      throwIfError(error, "Failed to list groups");
      return data;
    },

    async getById(id: string) {
      const { data, error } = await apiClient.GET(
        "/api/v1/screenshots/groups/{group_id}",
        {
          params: { path: { group_id: id } },
        },
      );
      throwIfError(error, "Failed to get group");
      return data;
    },
  },

  // Admin
  admin: {
    async getUsers() {
      const { data, error } = await apiClient.GET("/api/v1/admin/users");
      throwIfError(error, "Failed to get users");
      return data;
    },

    async updateUser(
      id: number,
      updates: { is_active?: boolean; role?: string },
    ) {
      const { data, error } = await apiClient.PUT(
        "/api/v1/admin/users/{user_id}",
        {
          params: {
            path: { user_id: id },
            query: updates,
          },
        },
      );
      throwIfError(error, "Failed to update user");
      return data;
    },

    async resetTestData() {
      const { data, error } = await apiClient.POST(
        "/api/v1/admin/reset-test-data",
      );
      throwIfError(error, "Failed to reset test data");
      return data;
    },

    async deleteGroup(groupId: string): Promise<DeleteGroupResponse> {
      const { data, error } = await apiClient.DELETE(
        "/api/v1/admin/groups/{group_id}",
        {
          params: { path: { group_id: groupId } },
        },
      );
      throwIfError(error, "Failed to delete group");
      return data!;
    },
  },

  // Export
  export: {
    getCSVUrl(groupId?: string): string {
      const params = groupId ? `?group_id=${groupId}` : "";
      return `${LEGACY_API_PREFIX}/screenshots/export/csv${params}`;
    },
  },
};

export default api;
