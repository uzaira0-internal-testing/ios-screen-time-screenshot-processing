import axios, { AxiosInstance } from 'axios';
import type { Annotation, AnnotationCreate } from '../../models';
import type { IAnnotationService } from '../../interfaces';

export class APIAnnotationService implements IAnnotationService {
  private api: AxiosInstance;

  constructor(baseURL: string) {
    this.api = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.api.interceptors.request.use((config) => {
      const username = localStorage.getItem('username');
      if (username && config.headers) {
        config.headers['X-Username'] = username;
      }
      const sitePassword = localStorage.getItem('sitePassword');
      if (sitePassword && config.headers) {
        config.headers['X-Site-Password'] = sitePassword;
      }
      return config;
    });
  }

  async create(data: AnnotationCreate): Promise<Annotation> {
    const response = await this.api.post<Annotation>('/annotations/', data);
    return response.data;
  }

  async update(id: number, data: Partial<AnnotationCreate>): Promise<Annotation> {
    const response = await this.api.put<Annotation>(`/annotations/${id}`, data);
    return response.data;
  }

  async getByScreenshot(screenshotId: number): Promise<Annotation[]> {
    const response = await this.api.get<Annotation[]>(`/annotations/screenshot/${screenshotId}`);
    return response.data;
  }

  async getHistory(skip = 0, limit = 50): Promise<Annotation[]> {
    const response = await this.api.get<Annotation[]>(
      `/annotations/history?skip=${skip}&limit=${limit}`
    );
    return response.data;
  }

  async delete(id: number): Promise<void> {
    await this.api.delete(`/annotations/${id}`);
  }
}
