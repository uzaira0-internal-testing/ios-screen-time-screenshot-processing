import type { Consensus } from '@/types';

export interface IConsensusService {
  getForScreenshot(screenshotId: number): Promise<Consensus>;
}
