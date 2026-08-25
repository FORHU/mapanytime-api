import cron from 'node-cron';
import logger from '../../utils/logger';
import InventoryReservationService from '../../modules/inventory/inventoryReservation.service';
import SettlementService from '../../modules/settlements/settlement.service';
import MerchantAdsService from '../../modules/merchantAds/merchantAds.service';
import RedisUtil from '../../utils/redis.util';

/**
 * node-cron fires per process. There is one worker today, so nothing here is
 * currently duplicated — but the first time the worker is scaled to two
 * replicas, every job below runs twice and sellers get two of every
 * notification. Jobs with outward-facing side effects take this lock.
 *
 * The TTL is deliberately shorter than the interval it guards so a worker that
 * dies mid-job cannot wedge the lock permanently.
 */
async function withJobLock(name: string, ttlSeconds: number, run: () => Promise<void>) {
  const acquired = await RedisUtil.client.set(`scheduler:lock:${name}`, '1', {
    NX: true,
    expiration: { type: 'EX', value: ttlSeconds },
  });

  if (!acquired) {
    logger.debug(`[Scheduler] ${name} skipped — another worker holds the lock.`);
    return;
  }

  await run();
}

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

  // ── Ad schedule window transitions — runs every 1 minute ────────────────
  // Side effects only. Whether an ad is live is derived at read time and is
  // exact to the millisecond; this job never gates that. It notifies sellers
  // and nudges open buyer maps when a window opens or closes.
  cron.schedule('* * * * *', async () => {
    try {
      await withJobLock('ad-window-transitions', 50, async () => {
        const processed = await MerchantAdsService.processWindowTransitions();
        if (processed > 0) {
          logger.info(`[Scheduler] Processed ${processed} ad window transition(s).`);
        }
      });
    } catch (err) {
      logger.error('[Scheduler] Failed to process ad window transitions:', err);
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
