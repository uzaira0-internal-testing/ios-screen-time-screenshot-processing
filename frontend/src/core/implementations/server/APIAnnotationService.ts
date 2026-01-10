import { api } from "@/services/apiClient";
import type { Annotation, AnnotationCreate } from "@/types";
import type { IAnnotationService } from "../../interfaces";

/**
 * Server-side annotation service using openapi-fetch apiClient.
 * No axios dependency - uses type-safe API client.
 */
export class APIAnnotationService implements IAnnotationService {
  constructor(_baseURL?: string) {
    // baseURL is no longer needed - apiClient handles this
  }

  async create(data: AnnotationCreate): Promise<Annotation> {
    // Transform null values to undefined for API compatibility
    const apiData = {
      ...data,
      extracted_title: data.extracted_title ?? undefined,
      extracted_total: data.extracted_total ?? undefined,
      grid_upper_left: data.grid_upper_left ?? undefined,
      grid_lower_right: data.grid_lower_right ?? undefined,
      time_spent_seconds: data.time_spent_seconds ?? undefined,
      notes: data.notes ?? undefined,
    };
    return api.annotations.create(apiData) as Promise<Annotation>;
  }

  async update(_id: number, _data: Partial<AnnotationCreate>): Promise<Annotation> {
    // Update endpoint not implemented in current API
    throw new Error("Annotation update not implemented");
  }

  async getByScreenshot(_screenshotId: number): Promise<Annotation[]> {
    // This endpoint doesn't exist in the API - annotations come with consensus
    return [];
  }

  async getHistory(skip = 0, limit = 50): Promise<Annotation[]> {
    const result = await api.annotations.getHistory({ skip, limit });
    return (result as Annotation[]) ?? [];
  }

  async delete(id: number): Promise<void> {
    await api.annotations.delete(id);
  }
}
