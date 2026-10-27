import cron from 'node-cron';
import logger from '../../utils/logger';
import InventoryReservationService from '../../modules/inventory/inventoryReservation.service';
import SettlementService from '../../modules/settlements/settlement.service';
import MerchantAdsService from '../../modules/merchantAds/merchantAds.service';
import RewardService from '../../modules/rewards/reward.service';
import StoreService from '../../modules/stores/store.service';
import OrderService from '../../modules/orders/order.service';
import AnalyticsService from '../../modules/analytics/analytics.service';
import { PaymentReconciliationJob } from '../../modules/payments/jobs/payment-reconciliation.job';
import AgentCommissionService from '../../modules/agent/agent-commission.service';
import { redis } from '../redis';
import { PENDING_ORDER_TTL_MINUTES } from '../../modules/orders/order.ttl';

/**
 * node-cron fires per process. There is one worker today, so nothing here is
 * currently duplicated — but the first time the worker is scaled to two
 * replicas, every job below runs twice and sellers get two of every
 * notification. Jobs with outward-facing side effects take this lock.
 *
 * The TTL is deliberately shorter than the interval it guards so a worker that
 * dies mid-job cannot wedge the lock permanently.
 *
 * The lock lives on the client the worker connects (`redis.connect()` in
 * worker.ts). It used to be `RedisUtil.client`, which only the API server
 * initialises, so in the worker every locked job threw and never ran (#143).
 * Without Redis the job runs unlocked: with one worker there is nothing to
 * duplicate, and skipping it would silently stop the job.
 */
async function withJobLock(name: string, ttlSeconds: number, run: () => Promise<void>) {
  const client = redis.getClient();

  if (!client) {
    logger.warn(`[Scheduler] Redis unavailable; running ${name} without its lock.`);
  } else {
    try {
      const acquired = await client.set(`scheduler:lock:${name}`, '1', {
        NX: true,
        expiration: { type: 'EX', value: ttlSeconds },
      });
      if (!acquired) {
        logger.debug(`[Scheduler] ${name} skipped — another worker holds the lock.`);
        return;
      }
    } catch (err) {
      logger.warn(`[Scheduler] Could not take the ${name} lock; running without it.`, err);
    }
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

  // ── Stale Pending Orders Expiry (F44) — runs every 2 minutes ────────────────
  cron.schedule('*/2 * * * *', async () => {
    try {
      const expiredCount = await OrderService.expireStalePendingOrders(PENDING_ORDER_TTL_MINUTES);
      if (expiredCount > 0) {
        logger.info(
          `[Scheduler] Expired ${expiredCount} stale pending order(s) and released holds.`,
        );
      }
    } catch (err) {
      logger.error('[Scheduler] Failed to process expired pending orders:', err);
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

  // ── MapPoints expiry sweep — runs hourly ────────────────────────────────
  // Expires EARN lots past their rolling expiry and stale claimed vouchers
  // past their own expiresAt. One job for both — see OPEN-FLAGS.md F44+F52
  // ("one scheduler, two problems").
  cron.schedule('30 * * * *', async () => {
    try {
      await withJobLock('mappoints-expiry', 300, async () => {
        const [pointsExpired, vouchersExpired] = await Promise.all([
          RewardService.expireOldPoints(),
          RewardService.expireStaleVouchers(),
        ]);
        if (pointsExpired > 0 || vouchersExpired > 0) {
          logger.info(
            `[Scheduler] Expired ${pointsExpired} MapPoints lot(s), ${vouchersExpired} voucher(s).`,
          );
        }
      });
    } catch (err) {
      logger.error('[Scheduler] MapPoints expiry sweep failed:', err);
    }
  });

  // ── Rejected-store purge — runs hourly ──────────────────────────────────
  // Removes stores whose 24-hour post-rejection window has run out. The window
  // is the database's to decide, not the seller's dashboard: a seller who never
  // opens the page must still have the store go away.
  //
  // Deliberately not under `withJobLock`. The sweep is idempotent (`deletedAt:
  // null` is in the WHERE, so a second run in the same hour matches nothing) and
  // has no outward-facing side effects to duplicate, so the lock would buy
  // nothing.
  cron.schedule('15 * * * *', async () => {
    try {
      const purged = await StoreService.purgeExpiredRejectedStores();
      if (purged > 0) {
        logger.info(`[Scheduler] Removed ${purged} expired rejected store(s).`);
      }
    } catch (err) {
      logger.error('[Scheduler] Rejected-store purge failed:', err);
    }
  });

  // ── Analytics Daily Rollup — runs daily at 00:05 UTC ────────────────────
  // Aggregates previous day's events into daily rollups for ranking and trending.
  cron.schedule('5 0 * * *', async () => {
    try {
      await withJobLock('analytics-daily-rollup', 1800, async () => {
        const count = await AnalyticsService.generateDailyRollups();
        if (count > 0) {
          logger.info(`[Scheduler] Generated ${count} analytics daily rollup record(s).`);
        }
      });
    } catch (err) {
      logger.error('[Scheduler] Failed to generate analytics daily rollups:', err);
    }
  });

  // ── Stripe Payment Reconciliation Sweeper — runs every 5 minutes ─────────
  // Sweeps pending payments older than 10 minutes to verify status with Stripe.
  cron.schedule('*/5 * * * *', async () => {
    try {
      await withJobLock('stripe-payment-reconciliation', 250, async () => {
        const job = new PaymentReconciliationJob();
        const result = await job.runReconciliation(10);
        if (result.inspected > 0) {
          logger.info(
            `[Scheduler] Stripe payment reconciliation completed: inspected=${result.inspected}, completed=${result.completed}, failed=${result.failed}, skipped=${result.skipped}`,
          );
        }
      });
    } catch (err) {
      logger.error('[Scheduler] Stripe payment reconciliation failed:', err);
    }
  });

  // ── Agent Commission Maturation — runs daily at 03:00 UTC ────────────────
  // Transitions PENDING commissions past their eligibility hold days into MATURED
  // and moves pendingBalance to availableBalance.
  cron.schedule('0 3 * * *', async () => {
    try {
      await withJobLock('agent-commission-maturation', 600, async () => {
        const matured = await AgentCommissionService.maturePendingCommissions();
        if (matured > 0) {
          logger.info(`[Scheduler] Matured ${matured} agent commission transaction(s).`);
        }
      });
    } catch (err) {
      logger.error('[Scheduler] Agent commission maturation sweep failed:', err);
    }
  });

  // There used to be a 2:00 AM "database cleanup" and a five-minute "cache flush" here.
  // Both bodies were log lines and nothing else, so the logs reported work that never
  // happened (F110). Redis keys already expire by TTL. Pruning consumed Session rows
  // (F103) is real work that belongs in a daily slot — add it as its own job when built.

  logger.info('[Scheduler] All jobs registered.');
};
