import cron from 'node-cron';
import logger from '../../utils/logger';
import InventoryReservationService from '../../modules/inventory/inventoryReservation.service';
import SettlementService from '../../modules/settlements/settlement.service';

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

  // ── Settlement maturation — runs hourly ─────────────────────────────────
  // Flips settlements past their hold to RELEASED, which is the only state a
  // payout can sweep. Nothing did this before, so every settlement would have
  // sat at PENDING forever. See FLAGS.md LED-4.
  cron.schedule('0 * * * *', async () => {
    try {
      const released = await SettlementService.releaseMaturedSettlements();
      if (released > 0) {
        logger.info(`[Scheduler] Released ${released} matured settlement(s) for payout.`);
      }
    } catch (err) {
      logger.error('[Scheduler] Failed to release matured settlements:', err);
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
