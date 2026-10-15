import { redis } from '../redis';
import logger from '../../utils/logger';

/**
 * How long a claim lasts while its work runs. A worker that dies mid-job
 * leaves the claim behind, so this is kept well inside the retries SQS makes
 * before dead-lettering (5 receives, 30s apart).
 */
const CLAIM_SECONDS = 60;
/**
 * How long finished work is remembered. Longer than SQS keeps a message (four
 * days by default), so a redelivery is still recognised however late it is.
 */
const DONE_SECONDS = 7 * 24 * 60 * 60;

const RUNNING = 'running';
const DONE = 'done';

/** Another worker is running the same key. Thrown so SQS retries it later. */
export class EventInProgressError extends Error {}

/**
 * Run `fn` at most once per `key`, for side effects that must not repeat when
 * SQS delivers the same event twice (sending an email).
 *
 * The key is claimed in Redis before `fn` runs and marked done after it
 * succeeds. A failure releases the claim, so the retry runs `fn` again. If
 * Redis is unreachable, `fn` runs anyway: a rare duplicate is better than a
 * lost email.
 *
 * Resolves true when `fn` ran, false when the key was already done.
 */
export const runOnce = async (key: string, fn: () => Promise<void>): Promise<boolean> => {
  const client = redis.getClient();
  const redisKey = `eventbus:once:${key}`;

  if (!client) {
    logger.warn(`[EventBus] Redis unavailable; running ${key} without a duplicate check.`);
    await fn();
    return true;
  }

  let claimed: string | null;
  try {
    claimed = await client.set(redisKey, RUNNING, {
      NX: true,
      expiration: { type: 'EX', value: CLAIM_SECONDS },
    });
  } catch (error) {
    logger.warn(`[EventBus] Redis claim failed; running ${key} without a duplicate check.`, error);
    await fn();
    return true;
  }

  if (!claimed) {
    const state = await client.get(redisKey).catch(() => null);
    if (state === DONE) {
      logger.info(`[EventBus] Skipping ${key}: already handled.`);
      return false;
    }
    throw new EventInProgressError(`${key} is being handled by another worker`);
  }

  try {
    await fn();
  } catch (error) {
    await client.del(redisKey).catch(() => {});
    throw error;
  }

  await client
    .set(redisKey, DONE, { expiration: { type: 'EX', value: DONE_SECONDS } })
    .catch((error) =>
      logger.warn(
        `[EventBus] Handled ${key} but could not mark it done; a redelivery would repeat it.`,
        error,
      ),
    );
  return true;
};
