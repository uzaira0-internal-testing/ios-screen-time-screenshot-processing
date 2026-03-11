export interface PerformanceMetrics {
  duration: number;
  memoryUsed?: number | undefined;
  timestamp: number;
}

export interface ProcessingMetrics extends PerformanceMetrics {
  screenshotId: number;
  stage: string;
}

class PerformanceMonitorClass {
  private measurements = new Map<string, number>();
  private metrics: ProcessingMetrics[] = [];

  startMeasurement(id: string): void {
    this.measurements.set(id, performance.now());
  }

  endMeasurement(id: string, metadata?: Partial<ProcessingMetrics>): PerformanceMetrics | null {
    const startTime = this.measurements.get(id);
    if (!startTime) {
      console.warn(`No measurement started for id: ${id}`);
      return null;
    }

    const duration = performance.now() - startTime;
    this.measurements.delete(id);

    const metrics: PerformanceMetrics = {
      duration,
      memoryUsed: this.getMemoryUsage(),
      timestamp: Date.now(),
    };

    if (metadata) {
      const processingMetrics: ProcessingMetrics = {
        ...metrics,
        screenshotId: metadata.screenshotId || 0,
        stage: metadata.stage || 'unknown',
      };
      this.metrics.push(processingMetrics);
    }

    return metrics;
  }

  measureProcessingTime(screenshotId: number, stage: string) {
    const measurementId = `screenshot-${screenshotId}-${stage}`;
    this.startMeasurement(measurementId);

    return {
      end: () => {
        const metrics = this.endMeasurement(measurementId, { screenshotId, stage });

        if (metrics && metrics.duration > 10000) {
          console.warn(
            `Slow processing detected for screenshot ${screenshotId} (${stage}): ${metrics.duration.toFixed(2)}ms`
          );
        }

        return metrics;
      },
    };
  }

  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Partial<ProcessingMetrics>
  ): Promise<T> {
    this.startMeasurement(name);

    try {
      const result = await fn();
      this.endMeasurement(name, metadata);
      return result;
    } catch (error) {
      this.endMeasurement(name, metadata);
      throw error;
    }
  }

  measure<T>(name: string, fn: () => T, metadata?: Partial<ProcessingMetrics>): T {
    this.startMeasurement(name);

    try {
      const result = fn();
      this.endMeasurement(name, metadata);
      return result;
    } catch (error) {
      this.endMeasurement(name, metadata);
      throw error;
    }
  }

  getMemoryUsage(): number | undefined {
    if ('memory' in performance) {
      // performance.memory is a Chrome-only API not in standard TS types
      const memory = (performance as Performance & { memory: { usedJSHeapSize: number } }).memory;
      return memory.usedJSHeapSize;
    }
    return undefined;
  }

  getMetrics(screenshotId?: number): ProcessingMetrics[] {
    if (screenshotId !== undefined) {
      return this.metrics.filter((m) => m.screenshotId === screenshotId);
    }
    return this.metrics;
  }

  getAverageProcessingTime(stage?: string): number | null {
    let relevantMetrics = this.metrics;

    if (stage) {
      relevantMetrics = this.metrics.filter((m) => m.stage === stage);
    }

    if (relevantMetrics.length === 0) {
      return null;
    }

    const totalDuration = relevantMetrics.reduce((sum, m) => sum + m.duration, 0);
    return totalDuration / relevantMetrics.length;
  }

  getSlowestProcessing(limit = 10): ProcessingMetrics[] {
    return [...this.metrics].sort((a, b) => b.duration - a.duration).slice(0, limit);
  }

  clearMetrics(): void {
    this.metrics = [];
  }

  getReport(): string {
    const report: string[] = [];

    report.push('=== Performance Report ===');
    report.push(`Total measurements: ${this.metrics.length}`);

    const avgTime = this.getAverageProcessingTime();
    if (avgTime !== null) {
      report.push(`Average processing time: ${avgTime.toFixed(2)}ms`);
    }

    const memUsage = this.getMemoryUsage();
    if (memUsage !== undefined) {
      report.push(`Current memory usage: ${(memUsage / 1024 / 1024).toFixed(2)} MB`);
    }

    const slowest = this.getSlowestProcessing(5);
    if (slowest.length > 0) {
      report.push('\nSlowest operations:');
      slowest.forEach((m, idx) => {
        report.push(
          `  ${idx + 1}. Screenshot ${m.screenshotId} (${m.stage}): ${m.duration.toFixed(2)}ms`
        );
      });
    }

    const stages = new Set(this.metrics.map((m) => m.stage));
    report.push('\nAverage time by stage:');
    stages.forEach((stage) => {
      const avg = this.getAverageProcessingTime(stage);
      if (avg !== null) {
        report.push(`  ${stage}: ${avg.toFixed(2)}ms`);
      }
    });

    return report.join('\n');
  }

  logReport(): void {
    console.log(this.getReport());
  }
}

export const PerformanceMonitor = new PerformanceMonitorClass();
