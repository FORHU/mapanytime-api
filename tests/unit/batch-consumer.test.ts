import { consumeBatch } from '../../src/infrastructure/rabbitmq/batch-consumer';
import { rabbitConnection } from '../../src/infrastructure/rabbitmq/connection';

jest.mock('../../src/infrastructure/rabbitmq/connection', () => ({
  rabbitConnection: { createDedicatedChannel: jest.fn() },
}));

jest.mock('../../src/infrastructure/rabbitmq/exchanges', () => ({
  APP_EXCHANGE: 'app.events',
  DLX_EXCHANGE: 'app.dlx',
}));

type Deliver = (msg: unknown) => void;

/** A fake channel that captures the consume callback so tests can push messages. */
const makeChannel = () => {
  let deliver: Deliver = () => undefined;

  const channel = {
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockImplementation((_queue: string, cb: Deliver) => {
      deliver = cb;
      return Promise.resolve({ consumerTag: 'tag' });
    }),
    ack: jest.fn(),
    nack: jest.fn(),
  };

  return { channel, deliver: (msg: unknown) => deliver(msg) };
};

/** A message carrying the DomainEventMessage envelope the publisher produces. */
const message = (payload: unknown, deliveryTag: number) => ({
  content: Buffer.from(JSON.stringify({ metadata: { eventId: `e${deliveryTag}` }, payload })),
  fields: { deliveryTag },
  properties: { headers: {} },
});

const OPTIONS = {
  queueName: 'test.queue',
  routingKey: 'test.key',
  batchSize: 3,
  flushIntervalMs: 5000,
};

let harness: ReturnType<typeof makeChannel>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  harness = makeChannel();
  (
    rabbitConnection.createDedicatedChannel as jest.MockedFunction<
      typeof rabbitConnection.createDedicatedChannel
    >
  ).mockResolvedValue(harness.channel as never);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('consumeBatch', () => {
  it('requests a dedicated channel with prefetch equal to the batch size', async () => {
    await consumeBatch(OPTIONS, jest.fn().mockResolvedValue(undefined));

    // The shared channel is prefetch(1), which makes buffering impossible:
    // message 2 is never delivered until message 1 is acked.
    expect(rabbitConnection.createDedicatedChannel).toHaveBeenCalledWith(3);
  });

  it('does not flush before the batch is full', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    await consumeBatch(OPTIONS, handler);

    harness.deliver(message({ n: 1 }, 1));
    harness.deliver(message({ n: 2 }, 2));
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    expect(harness.channel.ack).not.toHaveBeenCalled();
  });

  it('flushes once the batch is full and acks the whole range at once', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    await consumeBatch(OPTIONS, handler);

    const third = message({ n: 3 }, 3);
    harness.deliver(message({ n: 1 }, 1));
    harness.deliver(message({ n: 2 }, 2));
    harness.deliver(third);
    await jest.runAllTimersAsync();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([{ n: 1 }, { n: 2 }, { n: 3 }]);
    // allUpTo=true settles the batch in one frame rather than three.
    expect(harness.channel.ack).toHaveBeenCalledTimes(1);
    expect(harness.channel.ack).toHaveBeenCalledWith(third, true);
  });

  it('flushes a partial batch once the interval elapses', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    await consumeBatch(OPTIONS, handler);

    harness.deliver(message({ n: 1 }, 1));
    expect(handler).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5000);

    // Without the timer a quiet queue would hold events indefinitely.
    expect(handler).toHaveBeenCalledWith([{ n: 1 }]);
  });

  it('never acks before the handler resolves', async () => {
    let release!: () => void;
    const handler = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await consumeBatch(OPTIONS, handler);

    harness.deliver(message({ n: 1 }, 1));
    harness.deliver(message({ n: 2 }, 2));
    harness.deliver(message({ n: 3 }, 3));
    await Promise.resolve();

    // Acking here would mean a crash during the write loses the events.
    expect(handler).toHaveBeenCalled();
    expect(harness.channel.ack).not.toHaveBeenCalled();

    release();
    await jest.runAllTimersAsync();
    expect(harness.channel.ack).toHaveBeenCalledTimes(1);
  });

  it('nacks the batch to the DLQ without requeueing when the handler throws', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('insert failed'));
    await consumeBatch(OPTIONS, handler);

    const third = message({ n: 3 }, 3);
    harness.deliver(message({ n: 1 }, 1));
    harness.deliver(message({ n: 2 }, 2));
    harness.deliver(third);
    await jest.runAllTimersAsync();

    expect(harness.channel.ack).not.toHaveBeenCalled();
    // requeue=false — requeueing a batch that just failed spins a hot loop.
    expect(harness.channel.nack).toHaveBeenCalledWith(third, true, false);
  });

  it('discards an unparseable message individually without stalling the batch', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    await consumeBatch(OPTIONS, handler);

    const junk = { content: Buffer.from('not json'), fields: { deliveryTag: 1 }, properties: {} };
    harness.deliver(junk);

    // Left in the buffer it would sit inside a later allUpTo ack range and be
    // acked as though it had been processed.
    expect(harness.channel.nack).toHaveBeenCalledWith(junk, false, false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('re-arms the timer for a message that arrives while a timed flush is running', async () => {
    let release!: () => void;
    const handler = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    await consumeBatch(OPTIONS, handler);

    // Fill a batch so a flush is in flight and awaiting its slow handler.
    harness.deliver(message({ n: 1 }, 1));
    harness.deliver(message({ n: 2 }, 2));
    harness.deliver(message({ n: 3 }, 3));
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    // A fourth message lands mid-flush and arms the interval timer.
    harness.deliver(message({ n: 4 }, 4));

    // Let that timer fire *while the first flush is still running*. flush()
    // bails out at its `flushing` guard — before it reaches clearTimer().
    await jest.advanceTimersByTimeAsync(5000);
    expect(handler).toHaveBeenCalledTimes(1);

    release();
    await jest.runAllTimersAsync();

    // Regression: the timer callback has to null its own handle before
    // flushing. Leaving it set makes scheduleFlush() a no-op afterwards, and
    // this sub-batch-size message strands until unrelated traffic arrives.
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(2, [{ n: 4 }]);
  });

  it('keeps draining when messages arrive during a flush', async () => {
    let release!: () => void;
    const handler = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    await consumeBatch(OPTIONS, handler);

    harness.deliver(message({ n: 1 }, 1));
    harness.deliver(message({ n: 2 }, 2));
    harness.deliver(message({ n: 3 }, 3));
    await Promise.resolve();

    // Arrives mid-flush — must land in the next batch, not this ack range.
    harness.deliver(message({ n: 4 }, 4));

    release();
    await jest.runAllTimersAsync();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, [{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(handler).toHaveBeenNthCalledWith(2, [{ n: 4 }]);
  });
});
