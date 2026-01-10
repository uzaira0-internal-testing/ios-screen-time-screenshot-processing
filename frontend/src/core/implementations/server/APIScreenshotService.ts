import axios, { AxiosInstance } from "axios";
import type {
  Screenshot,
  GridCoordinates,
  ProcessingResult,
  QueueStats,
  ReprocessRequest,
  ScreenshotListResponse,
  ScreenshotListParams,
  NavigationResponse,
  NavigationParams,
} from "../../models";
import type { ImageType } from "@/types";
import type { IScreenshotService } from "../../interfaces";

export class APIScreenshotService implements IScreenshotService {
  private api: AxiosInstance;
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.api = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.api.interceptors.request.use((config) => {
      const username = localStorage.getItem("username");
      if (username && config.headers) {
        config.headers["X-Username"] = username;
      }
      return config;
    });
  }

  async getNext(
    groupId?: string,
    processingStatus?: string,
  ): Promise<Screenshot | null> {
    const params: Record<string, string> = {};
    if (groupId) params.group = groupId;
    if (processingStatus) params.processing_status = processingStatus;
    const response = await this.api.get<{ screenshot: Screenshot | null }>(
      "/screenshots/next",
      { params },
    );
    return response.data.screenshot;
  }

  async getById(id: number): Promise<Screenshot> {
    const response = await this.api.get<Screenshot>(`/screenshots/${id}`);
    return response.data;
  }

  async getAll(status?: string, skip = 0, limit = 50): Promise<Screenshot[]> {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    params.append("skip", skip.toString());
    params.append("limit", limit.toString());

    const response = await this.api.get<Screenshot[]>(
      `/screenshots?${params.toString()}`,
    );
    return response.data;
  }

  async upload(file: File, imageType: ImageType): Promise<Screenshot> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("image_type", imageType);

    const response = await this.api.post<Screenshot>(
      "/screenshots/upload",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    return response.data;
  }

  async getImageUrl(screenshotId: number): Promise<string> {
    // Return immediately - the URL is synchronous for server mode
    return `${this.baseURL}/screenshots/${screenshotId}/image`;
  }

  async getProcessingResult(screenshotId: number): Promise<ProcessingResult> {
    const response = await this.api.get<ProcessingResult>(
      `/screenshots/${screenshotId}/processing-result`,
    );
    return response.data;
  }

  async reprocess(
    screenshotId: number,
    coords: GridCoordinates,
    _onProgress?: (
      progress: import("../../interfaces/IProcessingService").ProcessingProgress,
    ) => void,
    maxShift?: number,
  ): Promise<ProcessingResult> {
    // Note: Server mode doesn't use progress callback - processing happens server-side
    const request: ReprocessRequest = {
      grid_upper_left_x: coords.upper_left.x,
      grid_upper_left_y: coords.upper_left.y,
      grid_lower_right_x: coords.lower_right.x,
      grid_lower_right_y: coords.lower_right.y,
      max_shift: maxShift ?? 5,
    };

    const response = await this.api.post<ProcessingResult>(
      `/screenshots/${screenshotId}/reprocess`,
      request,
      { timeout: 15000 }, // 15s timeout for optimization
    );
    return response.data;
  }

  async reprocessWithMethod(
    screenshotId: number,
    method: "ocr_anchored" | "line_based",
    _onProgress?: (
      progress: import("../../interfaces/IProcessingService").ProcessingProgress,
    ) => void,
    maxShift?: number,
  ): Promise<ProcessingResult> {
    // Note: Server mode doesn't use progress callback - processing happens server-side
    const request: ReprocessRequest = {
      processing_method: method,
      max_shift: maxShift ?? 5,
    };

    const response = await this.api.post<ProcessingResult>(
      `/screenshots/${screenshotId}/reprocess`,
      request,
      { timeout: 15000 }, // 15s timeout for optimization
    );
    return response.data;
  }

  async skip(screenshotId: number): Promise<void> {
    await this.api.post(`/screenshots/${screenshotId}/skip`);
  }

  async updateTitle(screenshotId: number, title: string): Promise<void> {
    await this.api.patch(`/screenshots/${screenshotId}`, {
      extracted_title: title,
    });
  }

  async updateHourlyData(
    screenshotId: number,
    hourlyData: Record<string, number>,
  ): Promise<void> {
    await this.api.patch(`/screenshots/${screenshotId}`, {
      extracted_hourly_data: hourlyData,
    });
  }

  async processIfNeeded(screenshot: Screenshot): Promise<Screenshot> {
    // In server mode, processing happens server-side, so just return as-is
    // The server should have already processed the screenshot
    return screenshot;
  }

  async getStats(): Promise<QueueStats> {
    const response = await this.api.get<QueueStats>("/screenshots/stats");
    return response.data;
  }

  async getList(params: ScreenshotListParams): Promise<ScreenshotListResponse> {
    const queryParams: Record<string, string> = {};
    if (params.page) queryParams.page = params.page.toString();
    if (params.page_size) queryParams.page_size = params.page_size.toString();
    if (params.group_id) queryParams.group_id = params.group_id;
    if (params.processing_status)
      queryParams.processing_status = params.processing_status;
    if (params.verified_by_me !== undefined)
      queryParams.verified_by_me = params.verified_by_me.toString();
    if (params.verified_by_others !== undefined)
      queryParams.verified_by_others = params.verified_by_others.toString();
    if (params.search) queryParams.search = params.search;
    if (params.sort_by) queryParams.sort_by = params.sort_by;
    if (params.sort_order) queryParams.sort_order = params.sort_order;

    const response = await this.api.get<ScreenshotListResponse>(
      "/screenshots/list",
      { params: queryParams },
    );
    return response.data;
  }

  async navigate(
    screenshotId: number,
    params: NavigationParams,
  ): Promise<NavigationResponse> {
    const queryParams: Record<string, string> = {};
    if (params.group_id) queryParams.group_id = params.group_id;
    if (params.processing_status)
      queryParams.processing_status = params.processing_status;
    if (params.verified_by_me !== undefined)
      queryParams.verified_by_me = params.verified_by_me.toString();
    if (params.verified_by_others !== undefined)
      queryParams.verified_by_others = params.verified_by_others.toString();
    if (params.direction) queryParams.direction = params.direction;

    const response = await this.api.get<NavigationResponse>(
      `/screenshots/${screenshotId}/navigate`,
      { params: queryParams },
    );
    return response.data;
  }

  async verify(
    screenshotId: number,
    gridCoords?: GridCoordinates,
  ): Promise<Screenshot> {
    const body = gridCoords
      ? {
          grid_upper_left_x: gridCoords.upper_left.x,
          grid_upper_left_y: gridCoords.upper_left.y,
          grid_lower_right_x: gridCoords.lower_right.x,
          grid_lower_right_y: gridCoords.lower_right.y,
        }
      : undefined;

    const response = await this.api.post<Screenshot>(
      `/screenshots/${screenshotId}/verify`,
      body,
    );
    return response.data;
  }

  async unverify(screenshotId: number): Promise<Screenshot> {
    const response = await this.api.delete<Screenshot>(
      `/screenshots/${screenshotId}/verify`,
    );
    return response.data;
  }

  async recalculateOcr(screenshotId: number): Promise<string | null> {
    const response = await this.api.post<{
      success: boolean;
      extracted_total: string | null;
      message: string;
    }>(`/screenshots/${screenshotId}/recalculate-ocr`);

    if (response.data.success) {
      return response.data.extracted_total;
    }
    return null;
  }
}
