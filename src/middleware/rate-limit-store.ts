import { MemoryStore, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import RedisUtil from '../utils/redis.util';
import logger from '../utils/logger';

/**
 * `isReady`, not `isOpen`: node-redis keeps `isOpen` true while it reconnects and queues
 * commands meanwhile, so an `isOpen` check would hang requests instead of failing over.
 */
export const redisReady = () => Boolean(RedisUtil.client?.isReady);

/**
 * Shared Redis counters when Redis is up, this instance's memory when it isn't.
 *
 * The choice is made on every call, not when the limiter is built. The limiters are created
 * when app.ts is imported — before server.ts connects Redis — so deciding up front pinned
 * every instance to memory for its whole life. Deciding per call also covers Redis dropping
 * or coming back mid-run, and a failing Redis command falls back instead of surfacing as a 500.
 */
export class FailoverStore implements Store {
  /** Unique per limiter: express-rate-limit tells stores apart by prefix when checking double counts. */
  readonly prefix: string;
  private readonly memory = new MemoryStore();
  private redis?: Promise<RedisStore>;
  private options?: Options;
  private failing = false;

  constructor(name: string) {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options) {
    this.options = options;
    this.memory.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redis = await this.redisStore();
    if (redis) {
      try {
        const result = await redis.increment(key);
        this.recovered();
        return result;
      } catch (err) {
        this.failed(err);
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string) {
    const redis = await this.redisStore();
    if (redis) {
      try {
        return await redis.decrement(key);
      } catch (err) {
        this.failed(err);
      }
    }
    return this.memory.decrement(key);
  }

  async resetKey(key: string) {
    this.memory.resetKey(key);
    const redis = await this.redisStore();
    await redis?.resetKey(key).catch((err) => this.failed(err));
  }

  shutdown() {
    this.memory.shutdown();
  }

  /** Built on first use while Redis is ready; RedisStore loads its Lua scripts in init. */
  private async redisStore(): Promise<RedisStore | undefined> {
    if (!redisReady() || !this.options) return undefined;
    if (!this.redis) {
      const options = this.options;
      this.redis = (async () => {
        const store = new RedisStore({
          sendCommand: (...args: string[]) =>
            RedisUtil.client.sendCommand(args) as Promise<
              boolean | number | string | (boolean | number | string)[]
            >,
          prefix: this.prefix,
        });
        await store.init(options);
        return store;
      })();
      // A failed script load is retried on the next call rather than cached.
      this.redis.catch(() => (this.redis = undefined));
    }
    try {
      return await this.redis;
    } catch (err) {
      this.failed(err);
      return undefined;
    }
  }

  private failed(err: unknown) {
    if (this.failing) return;
    this.failing = true;
    logger.error(
      `[RateLimit] ${this.prefix} Redis store failed; counting in this instance's memory until it recovers`,
      { error: (err as Error)?.message },
    );
  }

  private recovered() {
    if (!this.failing) return;
    this.failing = false;
    logger.info(`[RateLimit] ${this.prefix} Redis store recovered`);
  }
}
