/**
 * Performance monitoring utilities for tracking app performance metrics
 */

export interface ProcessingMetrics {
  screenshotId: number;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string | undefined;
}

export interface MemoryMetrics {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

export class PerformanceMonitor {
  private static processingMetrics: ProcessingMetrics[] = [];
  private static memorySnapshots: MemoryMetrics[] = [];
  private static maxMetricsHistory = 100;
  private static memoryInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Measure processing time for a screenshot
   */
  static measureProcessingTime(screenshotId: number) {
    const startTime = performance.now();

    return {
      end: (success: boolean = true, error?: string) => {
        const endTime = performance.now();
        const duration = endTime - startTime;

        const metric: ProcessingMetrics = {
          screenshotId,
          startTime,
          endTime,
          duration,
          success,
          error,
        };

        this.processingMetrics.push(metric);

        // Keep only last N metrics
        if (this.processingMetrics.length > this.maxMetricsHistory) {
          this.processingMetrics.shift();
        }

        // Log slow processing
        if (duration > 10000) {
          console.warn(
            `Slow processing detected for screenshot ${screenshotId}: ${duration}ms`,
          );
        }

        // Log to console in development
        if (import.meta.env?.MODE === "development") {
          console.log(
            `Processing screenshot ${screenshotId}: ${duration.toFixed(0)}ms`,
          );
        }

        return metric;
      },
    };
  }

  /**
   * Get memory usage if available (Chrome only)
   */
  static measureMemory(): MemoryMetrics | null {
    if ("memory" in performance) {
      // performance.memory is a Chrome-only API not in standard TS types
      const memory = (performance as Performance & { memory: MemoryMetrics }).memory;
      const metrics: MemoryMetrics = {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        timestamp: Date.now(),
      };

      this.memorySnapshots.push(metrics);

      // Keep only last N snapshots
      if (this.memorySnapshots.length > this.maxMetricsHistory) {
        this.memorySnapshots.shift();
      }

      return metrics;
    }

    return null;
  }

  /**
   * Get average processing time
   */
  static getAverageProcessingTime(): number {
    if (this.processingMetrics.length === 0) return 0;

    const sum = this.processingMetrics.reduce(
      (acc, metric) => acc + metric.duration,
      0,
    );
    return sum / this.processingMetrics.length;
  }

  /**
   * Get processing success rate
   */
  static getSuccessRate(): number {
    if (this.processingMetrics.length === 0) return 100;

    const successful = this.processingMetrics.filter((m) => m.success).length;
    return (successful / this.processingMetrics.length) * 100;
  }

  /**
   * Get memory usage trend
   */
  static getMemoryTrend(): "increasing" | "stable" | "decreasing" | "unknown" {
    if (this.memorySnapshots.length < 5) return "unknown";

    const recent = this.memorySnapshots.slice(-5);
    const first = recent[0]?.usedJSHeapSize;
    const last = recent[recent.length - 1]?.usedJSHeapSize;

    if (!first || !last) return "unknown";

    const percentChange = ((last - first) / first) * 100;

    if (percentChange > 10) return "increasing";
    if (percentChange < -10) return "decreasing";
    return "stable";
  }

  /**
   * Check if memory usage is concerning
   */
  static isMemoryUsageHigh(): boolean {
    const memory = this.measureMemory();
    if (!memory) return false;

    const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
    return usagePercent > 80;
  }

  /**
   * Get performance summary
   */
  static getSummary() {
    const currentMemory = this.measureMemory();

    return {
      processing: {
        count: this.processingMetrics.length,
        averageTime: this.getAverageProcessingTime(),
        successRate: this.getSuccessRate(),
      },
      memory: currentMemory
        ? {
            used: this.formatBytes(currentMemory.usedJSHeapSize),
            total: this.formatBytes(currentMemory.totalJSHeapSize),
            limit: this.formatBytes(currentMemory.jsHeapSizeLimit),
            usagePercent: (
              (currentMemory.usedJSHeapSize / currentMemory.jsHeapSizeLimit) *
              100
            ).toFixed(1),
            trend: this.getMemoryTrend(),
          }
        : null,
    };
  }

  /**
   * Format bytes to human-readable string
   */
  private static formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * Stop periodic monitoring.
   */
  static dispose() {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = null;
    }
  }

  /**
   * Clear all metrics
   */
  static clearMetrics() {
    this.processingMetrics = [];
    this.memorySnapshots = [];
  }

  /**
   * Get all processing metrics
   */
  static getAllProcessingMetrics(): ProcessingMetrics[] {
    return [...this.processingMetrics];
  }

  /**
   * Get all memory snapshots
   */
  static getAllMemorySnapshots(): MemoryMetrics[] {
    return [...this.memorySnapshots];
  }

  /**
   * Mark web vitals (Core Web Vitals)
   */
  static markWebVital(name: string, value: number) {
    if ("performance" in window && "measure" in performance) {
      try {
        performance.measure(name, {
          start: 0,
          duration: value,
        });

        if (import.meta.env?.MODE === "development") {
          console.log(`Web Vital - ${name}: ${value.toFixed(2)}ms`);
        }
      } catch (e) {
        // Silently fail if performance API not available
      }
    }
  }

  /**
   * Measure First Input Delay (FID)
   */
  static measureFID() {
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === "first-input") {
              // PerformanceEventTiming has processingStart but isn't in all TS DOM lib versions
              const fidEntry = entry as PerformanceEntry & { processingStart: number };
              const fid = fidEntry.processingStart - entry.startTime;
              this.markWebVital("FID", fid);
            }
          }
        });

        observer.observe({ type: "first-input", buffered: true });
      } catch (e) {
        // Silently fail
      }
    }
  }

  /**
   * Measure Cumulative Layout Shift (CLS)
   */
  static measureCLS() {
    if ("PerformanceObserver" in window) {
      try {
        let clsValue = 0;

        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            // Layout shift entries have hadRecentInput and value but aren't in standard TS types
            const layoutEntry = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
            if (!layoutEntry.hadRecentInput) {
              clsValue += layoutEntry.value;
              this.markWebVital("CLS", clsValue);
            }
          }
        });

        observer.observe({ type: "layout-shift", buffered: true });
      } catch (e) {
        // Silently fail
      }
    }
  }

  /**
   * Initialize all performance monitoring
   */
  static initialize() {
    // Measure Core Web Vitals
    this.measureFID();
    this.measureCLS();

    // Take initial memory snapshot
    this.measureMemory();

    // Periodic memory snapshots (every 30 seconds)
    this.memoryInterval = setInterval(() => {
      this.measureMemory();
    }, 30000);

    if (import.meta.env?.MODE === "development") {
      console.log("Performance monitoring initialized");
    }
  }
}
