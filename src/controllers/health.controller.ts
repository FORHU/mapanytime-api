import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { redis } from "../infrastructure/redis";
import { rabbitmq } from "../infrastructure/rabbitmq";

/**
 * GET /health/live
 *
 * Liveness check — confirms the process is alive and running.
 * Kubernetes uses this to know if it should restart the container.
 * This should NEVER check external dependencies.
 */
export const liveness = (_req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
};

/**
 * GET /health/ready
 *
 * Readiness check — confirms all infrastructure dependencies are up.
 * Kubernetes uses this to decide if traffic should be routed to this pod.
 * A single failure flips the overall status to "degraded".
 */
export const readiness = async (_req: Request, res: Response) => {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkRabbitMQ(),
  ]);

  const [dbCheck, redisCheck, rmqCheck] = checks;

  const services = {
    database: dbCheck.status === "fulfilled" && dbCheck.value ? "up" : "down",
    redis:
      redisCheck.status === "fulfilled" && redisCheck.value ? "up" : "down",
    rabbitmq: rmqCheck.status === "fulfilled" && rmqCheck.value ? "up" : "down",
  };

  const isHealthy = Object.values(services).every((s) => s === "up");

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ready" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    services,
  });
};

const checkDatabase = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};

const checkRedis = async (): Promise<boolean> => {
  try {
    return await redis.ping();
  } catch {
    return false;
  }
};

const checkRabbitMQ = async (): Promise<boolean> => {
  return rabbitmq.isReady();
};
