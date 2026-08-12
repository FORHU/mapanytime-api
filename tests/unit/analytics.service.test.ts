import AnalyticsService from '../../src/modules/analytics/analytics.service';
import AnalyticsRepository from '../../src/modules/analytics/analytics.repository';
import { rabbitmq } from '../../src/infrastructure/rabbitmq';
import { ROUTING_KEYS } from '../../src/events/routing-keys';
import { AnalyticsEventPayload } from '../../src/modules/analytics/analytics.types';

jest.mock('../../src/infrastructure/rabbitmq', () => ({
  rabbitmq: { publish: jest.fn() },
}));

jest.mock('../../src/modules/analytics/analytics.repository', () => ({
  __esModule: true,
  default: { createMany: jest.fn(), create: jest.fn() },
}));

const mockPublish = rabbitmq.publish as jest.MockedFunction<typeof rabbitmq.publish>;
const mockCreateMany = AnalyticsRepository.createMany as jest.MockedFunction<
  typeof AnalyticsRepository.createMany
>;

const context = {
  userId: 'user-1',
  ipAddress: '203.0.113.7',
  userAgent: 'jest-agent',
};

/** The payload handed to rabbitmq.publish on the nth call. */
const publishedPayload = (call = 0): AnalyticsEventPayload =>
  mockPublish.mock.calls[call][1] as AnalyticsEventPayload;

beforeEach(() => {
  jest.clearAllMocks();
  mockPublish.mockResolvedValue(true);
  mockCreateMany.mockResolvedValue(1);
});

describe('AnalyticsService.record', () => {
  it('publishes one message per event on the analytics routing key', async () => {
    const result = await AnalyticsService.record(
      [{ eventType: 'PRODUCT_VIEW' }, { eventType: 'SEARCH' }],
      context,
    );

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish.mock.calls[0][0]).toBe(ROUTING_KEYS.ANALYTICS_EVENT_RECORDED);
    expect(result).toEqual({ accepted: 2, transport: 'queued' });
    // The happy path must never touch the database — that is the entire point.
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  describe('attribution', () => {
    it('takes userId, ip and user-agent from the request context', async () => {
      await AnalyticsService.record([{ eventType: 'STORE_VIEW' }], context);

      const payload = publishedPayload();
      expect(payload.userId).toBe('user-1');
      expect(payload.ipAddress).toBe('203.0.113.7');
      expect(payload.userAgent).toBe('jest-agent');
    });

    it('ignores a userId supplied in the event body', async () => {
      // Trusting a body-supplied userId would let any caller attribute events
      // to somebody else and skew every ranking derived from them.
      const hostile = { eventType: 'STORE_VIEW', userId: 'victim' } as never;
      await AnalyticsService.record([hostile], { ...context, userId: 'user-1' });

      expect(publishedPayload().userId).toBe('user-1');
    });

    it('records a null userId for anonymous traffic but keeps the sessionId', async () => {
      await AnalyticsService.record([{ eventType: 'PRODUCT_VIEW', sessionId: 'sess-9' }], {
        userId: null,
        ipAddress: null,
        userAgent: null,
      });

      const payload = publishedPayload();
      expect(payload.userId).toBeNull();
      expect(payload.sessionId).toBe('sess-9');
    });
  });

  describe('occurredAt', () => {
    it('keeps a valid past timestamp from the client', async () => {
      const past = '2026-08-01T10:00:00.000Z';
      await AnalyticsService.record([{ eventType: 'SEARCH', occurredAt: past }], context);

      expect(publishedPayload().occurredAt).toBe(past);
    });

    it('replaces a future timestamp with receipt time', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await AnalyticsService.record([{ eventType: 'SEARCH', occurredAt: future }], context);

      // A client clock hours ahead would otherwise park events in the future
      // where day-bucketed aggregation never picks them up.
      expect(new Date(publishedPayload().occurredAt).getTime()).toBeLessThan(
        new Date(future).getTime(),
      );
    });

    it('replaces an unparseable timestamp with receipt time', async () => {
      await AnalyticsService.record([{ eventType: 'SEARCH', occurredAt: 'not-a-date' }], context);

      expect(Number.isNaN(new Date(publishedPayload().occurredAt).getTime())).toBe(false);
    });

    it('defaults to receipt time when omitted', async () => {
      const before = Date.now();
      await AnalyticsService.record([{ eventType: 'SEARCH' }], context);
      const stamped = new Date(publishedPayload().occurredAt).getTime();

      expect(stamped).toBeGreaterThanOrEqual(before - 1000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  describe('when RabbitMQ is unreachable', () => {
    it('writes the events straight to the database instead of dropping them', async () => {
      mockPublish.mockResolvedValue(false);

      const result = await AnalyticsService.record(
        [{ eventType: 'PRODUCT_VIEW' }, { eventType: 'ADD_TO_CART' }],
        context,
      );

      expect(result).toEqual({ accepted: 2, transport: 'direct' });
      expect(mockCreateMany).toHaveBeenCalledTimes(1);
      expect(mockCreateMany.mock.calls[0][0]).toHaveLength(2);
    });

    it('falls back for only the events that failed to publish', async () => {
      mockPublish.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = await AnalyticsService.record(
        [{ eventType: 'PRODUCT_VIEW' }, { eventType: 'ADD_TO_CART' }],
        context,
      );

      expect(result.transport).toBe('direct');
      const written = mockCreateMany.mock.calls[0][0];
      expect(written).toHaveLength(1);
      expect(written[0].eventType).toBe('ADD_TO_CART');
    });

    it('propagates the error when the fallback write also fails', async () => {
      mockPublish.mockResolvedValue(false);
      mockCreateMany.mockRejectedValue(new Error('db down'));

      // Both transports gone is a real failure and the caller must hear about
      // it — swallowing it would silently discard behavioural data.
      await expect(AnalyticsService.record([{ eventType: 'SEARCH' }], context)).rejects.toThrow(
        'db down',
      );
    });
  });
});
