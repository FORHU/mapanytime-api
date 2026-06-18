import os from "os";
import logger from "./logger";

const METRICS_INTERVAL_MS = Number(process.env.METRICS_INTERVAL_MS || 60_000);

interface JobMetric {
  jobId: string;
  jobType: string;
  durationMs: number;
  status: "success" | "failed" | "timeout";
  timestamp: number;
}

/**
 * Lightweight in-process metrics tracker for the Worker process.
 *
 * Consumers call `workerMetrics.recordJob(...)` after each job completes.
 * The periodic snapshot is persisted to Redis so the main API can expose
 * it via the health endpoint — no cross-process IPC required.
 *
 * Usage:
 *   const start = Date.now();
 *   try {
 *     await handler(payload);
 *     workerMetrics.recordJob({ jobId, jobType, durationMs: Date.now() - start, status: "success" });
 *   } catch {
 *     workerMetrics.recordJob({ jobId, jobType, durationMs: Date.now() - start, status: "failed" });
 *   }
 */
export class WorkerMetrics {
  private jobsProcessed = 0;
  private jobsFailed = 0;
  private jobsTimedOut = 0;
  private totalDurationMs = 0;
  private recentJobs: JobMetric[] = [];
  private startedAt = Date.now();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  recordJob(metric: Omit<JobMetric, "timestamp">) {
    const entry: JobMetric = { ...metric, timestamp: Date.now() };
    this.recentJobs.push(entry);

    if (metric.status === "success") {
      this.jobsProcessed++;
      this.totalDurationMs += metric.durationMs;
    } else if (metric.status === "timeout") {
      this.jobsTimedOut++;
      this.jobsFailed++;
    } else {
      this.jobsFailed++;
    }

    // Keep only the last 100 jobs in memory
    if (this.recentJobs.length > 100) {
      this.recentJobs = this.recentJobs.slice(-100);
    }
  }

  getSnapshot() {
    const mem = process.memoryUsage();
    return {
      status: "running",
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      jobs: {
        processed: this.jobsProcessed,
        failed: this.jobsFailed,
        timedOut: this.jobsTimedOut,
        avgDurationMs:
          this.jobsProcessed > 0
            ? Math.round(this.totalDurationMs / this.jobsProcessed)
            : 0,
      },
      system: {
        cpus: os.cpus().length,
        loadAvg1m: parseFloat(os.loadavg()[0].toFixed(2)),
        memoryRss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        memoryHeap: `${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
        freeMem: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
      },
    };
  }

  /**
   * Start periodic metric logging and Redis persistence.
   * The main API reads `worker:metrics:snapshot` from Redis to serve health data.
   */
  startPeriodicLogging() {
    this.intervalHandle = setInterval(async () => {
      const snapshot = this.getSnapshot();
      logger.info("[WorkerMetrics] Periodic snapshot", snapshot);

      try {
        const { redis } = await import("../infrastructure/redis");
        const client = redis.getClient();
        await client.set("worker:metrics:snapshot", JSON.stringify(snapshot), {
          EX: 300, // 5 min TTL — stale if worker dies
        });
      } catch (err) {
        logger.error(
          "[WorkerMetrics] Failed to persist snapshot to Redis:",
          err,
        );
      }
    }, METRICS_INTERVAL_MS);

    // Unref so this timer doesn't prevent the process from exiting cleanly
    if (this.intervalHandle.unref) this.intervalHandle.unref();
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}

export const workerMetrics = new WorkerMetrics();
