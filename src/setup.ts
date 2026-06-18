import logger from "./utils/logger";
import { redis } from "./infrastructure/redis";

/**
 * Initial setup logic for the application
 */
export default async function setup() {
  logger.info("Running initial application setup...");

  // Initialize Redis infrastructure singleton
  await redis.connect();

  logger.info("Setup completed.");
}
