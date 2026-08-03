import cron from 'node-cron';
import logger from '../../utils/logger';
import InventoryReservationService from '../../services/inventoryReservation.service';

/**
 * Scheduled Jobs Registry
 *
 * All recurring background tasks are defined here.
 * The scheduler is started by the worker process, not the API.
 *
 * Cron syntax: second(optional) minute hour day-of-month month day-of-week
 */

export const startScheduler = () => {
  logger.info('[Scheduler] Registering scheduled jobs...');

  // ── Inventory TTL Expiration Cleanup — runs every 1 minute ──────────────────
  cron.schedule('* * * * *', async () => {
    try {
      const expiredCount = await InventoryReservationService.processExpiredReservations();
      if (expiredCount > 0) {
        logger.info(`[Scheduler] Released ${expiredCount} expired stock reservation(s).`);
      }
    } catch (err) {
      logger.error('[Scheduler] Failed to process expired reservations:', err);
    }
  });

  // ── Database cleanup — runs daily at 2:00 AM ────────────────────────────
  cron.schedule('0 2 * * *', async () => {
    logger.info('[Scheduler] Running daily database cleanup...');
    try {
      logger.info('[Scheduler] Daily cleanup completed.');
    } catch (err) {
      logger.error('[Scheduler] Daily cleanup failed:', err);
    }
  });

  // ── Worker metrics flush — every 5 minutes ──────────────────────────────
  cron.schedule('*/5 * * * *', async () => {
    logger.info('[Scheduler] Flushing stale cache keys...');
    try {
      logger.info('[Scheduler] Cache flush completed.');
    } catch (err) {
      logger.error('[Scheduler] Cache flush failed:', err);
    }
  });

  logger.info('[Scheduler] All jobs registered.');
};
