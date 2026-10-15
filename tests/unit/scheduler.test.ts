import cron from 'node-cron';
import { startScheduler } from '../../src/infrastructure/scheduler';
import { redis } from '../../src/infrastructure/redis';
import MerchantAdsService from '../../src/modules/merchantAds/merchantAds.service';
import RewardService from '../../src/modules/rewards/reward.service';

jest.mock('node-cron', () => ({ __esModule: true, default: { schedule: jest.fn() } }));

// The worker connects this client and never calls RedisUtil.initialize().
jest.mock('../../src/infrastructure/redis', () => ({ redis: { getClient: jest.fn() } }));

jest.mock('../../src/modules/inventory/inventoryReservation.service', () => ({
  __esModule: true,
  default: { processExpiredReservations: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../../src/modules/settlements/settlement.service', () => ({
  __esModule: true,
  default: { releaseMaturedSettlements: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../../src/modules/merchantAds/merchantAds.service', () => ({
  __esModule: true,
  default: { processWindowTransitions: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../../src/modules/rewards/reward.service', () => ({
  __esModule: true,
  default: {
    expireOldPoints: jest.fn().mockResolvedValue(0),
    expireStaleVouchers: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('../../src/modules/stores/store.service', () => ({
  __esModule: true,
  default: { purgeExpiredRejectedStores: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../../src/modules/orders/order.service', () => ({
  __esModule: true,
  default: { expireStalePendingOrders: jest.fn().mockResolvedValue(0) },
}));

const schedule = cron.schedule as unknown as jest.Mock;
const getClient = redis.getClient as jest.Mock;

/** Start the scheduler as the worker does, then fire every job once. */
const runEveryJob = async () => {
  startScheduler();
  for (const [, job] of schedule.mock.calls) await job();
};

const lockedJobsRan = () => ({
  ads: (MerchantAdsService.processWindowTransitions as jest.Mock).mock.calls.length,
  points: (RewardService.expireOldPoints as jest.Mock).mock.calls.length,
});

beforeEach(() => jest.clearAllMocks());

describe('scheduler job lock', () => {
  it('takes the lock on the worker’s redis client and runs the job', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    getClient.mockReturnValue({ set });

    await runEveryJob();

    expect(lockedJobsRan()).toEqual({ ads: 1, points: 1 });
    expect(set).toHaveBeenCalledWith(
      'scheduler:lock:ad-window-transitions',
      '1',
      expect.objectContaining({ NX: true }),
    );
  });

  it('skips the job while another worker holds the lock', async () => {
    getClient.mockReturnValue({ set: jest.fn().mockResolvedValue(null) });

    await runEveryJob();

    expect(lockedJobsRan()).toEqual({ ads: 0, points: 0 });
  });

  it('runs the job without a lock when redis is unavailable', async () => {
    getClient.mockReturnValue(null);

    await runEveryJob();

    expect(lockedJobsRan()).toEqual({ ads: 1, points: 1 });
  });

  it('runs the job without a lock when redis errors', async () => {
    getClient.mockReturnValue({ set: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });

    await runEveryJob();

    expect(lockedJobsRan()).toEqual({ ads: 1, points: 1 });
  });
});
