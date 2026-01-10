import axios, { AxiosInstance } from 'axios';
import type { Consensus } from '../../models';
import type { IConsensusService } from '../../interfaces';

export class APIConsensusService implements IConsensusService {
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
      return config;
    });
  }

  async getForScreenshot(screenshotId: number): Promise<Consensus> {
    const response = await this.api.get<Consensus>(`/consensus/${screenshotId}`);
    return response.data;
  }
}
