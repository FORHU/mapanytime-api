import { runOnce, EventInProgressError } from '../../src/infrastructure/event-bus/idempotency';
import { redis } from '../../src/infrastructure/redis';

jest.mock('../../src/infrastructure/redis', () => ({
  redis: { getClient: jest.fn() },
}));

const getClient = redis.getClient as jest.Mock;

/** Just enough of a redis client for `runOnce`: SET with NX and a TTL, GET, DEL. */
const makeFakeRedis = () => {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, options?: { NX?: boolean }) => {
      if (options?.NX && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
};

let fakeRedis: ReturnType<typeof makeFakeRedis>;

beforeEach(() => {
  fakeRedis = makeFakeRedis();
  getClient.mockReturnValue(fakeRedis);
});

describe('runOnce', () => {
  it('runs a key once and skips it when the event is delivered again', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await expect(runOnce('email:e1', fn)).resolves.toBe(true);
    await expect(runOnce('email:e1', fn)).resolves.toBe(false);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys apart', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await runOnce('email:e1', fn);
    await runOnce('email:e2', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('releases the claim when the work fails, so the retry runs it', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('smtp down')).mockResolvedValue(undefined);

    await expect(runOnce('email:e1', fn)).rejects.toThrow('smtp down');
    await expect(runOnce('email:e1', fn)).resolves.toBe(true);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws while another worker holds the claim, so SQS retries it later', async () => {
    let finish!: () => void;
    const slow = runOnce(
      'email:e1',
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await new Promise((r) => setImmediate(r));

    const second = jest.fn();
    await expect(runOnce('email:e1', second)).rejects.toBeInstanceOf(EventInProgressError);
    expect(second).not.toHaveBeenCalled();

    finish();
    await expect(slow).resolves.toBe(true);
  });

  it('runs the work anyway when redis is unavailable', async () => {
    getClient.mockReturnValue(null);
    const fn = jest.fn().mockResolvedValue(undefined);

    await expect(runOnce('email:e1', fn)).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs the work anyway when redis errors', async () => {
    fakeRedis.set.mockRejectedValueOnce(new Error('ECONNRESET'));
    const fn = jest.fn().mockResolvedValue(undefined);

    await expect(runOnce('email:e1', fn)).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
