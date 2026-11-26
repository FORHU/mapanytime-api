import { consumeBatch } from '../../src/infrastructure/event-bus/batch-consumer';
import { makeFakeSqs, waitFor } from '../helpers/fake-sqs';

const fake = makeFakeSqs();

jest.mock('../../src/infrastructure/event-bus/clients', () => ({
  sqs: { send: (command: never) => fake.send(command) },
  sns: { send: jest.fn() },
}));

/** The fields of a batch entry these tests look at. */
type Entry = { ReceiptHandle: string; VisibilityTimeout?: number };

const OPTIONS = {
  queueUrl: 'http://localhost:4566/000000000000/test-queue',
  batchSize: 3,
  flushIntervalMs: 60,
  retryDelaySeconds: 30,
};

/** Every receipt handle deleted so far, across single and batch deletes. */
const deleted = () => [
  ...fake
    .callsTo('DeleteMessageBatchCommand')
    .flatMap((i) => i.Entries.map((e: Entry) => e.ReceiptHandle)),
  ...fake.callsTo('DeleteMessageCommand').map((i) => i.ReceiptHandle),
];

beforeEach(() => fake.reset());

describe('consumeBatch', () => {
  it('flushes once the batch is full and deletes it in one call', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    [1, 2, 3].forEach((n) => fake.push({ n }));

    const consumer = consumeBatch(OPTIONS, handler);
    await waitFor(() => fake.callsTo('DeleteMessageBatchCommand').length === 1);
    await consumer.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([{ n: 1 }, { n: 2 }, { n: 3 }], expect.anything());
    expect(deleted()).toEqual(['r1', 'r2', 'r3']);
  });

  it('asks only for what still fits in the batch', async () => {
    fake.push({ n: 1 });
    fake.push({ n: 2 });

    const consumer = consumeBatch(OPTIONS, jest.fn().mockResolvedValue(undefined));
    await waitFor(() => fake.callsTo('ReceiveMessageCommand').length >= 2);
    await consumer.stop();

    const [first, second] = fake.callsTo('ReceiveMessageCommand');
    expect(first.MaxNumberOfMessages).toBe(3);
    expect(second.MaxNumberOfMessages).toBe(1);
  });

  it('flushes a partial batch once the interval elapses', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ n: 1 });

    const consumer = consumeBatch(OPTIONS, handler);
    await waitFor(() => handler.mock.calls.length === 1);
    await consumer.stop();

    // Without the deadline a quiet queue would hold events indefinitely.
    expect(handler).toHaveBeenCalledWith([{ n: 1 }], expect.anything());
  });

  it('never deletes before the handler resolves', async () => {
    let release!: () => void;
    const handler = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    [1, 2, 3].forEach((n) => fake.push({ n }));

    const consumer = consumeBatch(OPTIONS, handler);
    await waitFor(() => handler.mock.calls.length === 1);

    // Deleting here would mean a crash during the write loses the events.
    expect(deleted()).toEqual([]);

    release();
    await consumer.stop();
    expect(deleted()).toEqual(['r1', 'r2', 'r3']);
  });

  it('hands a failed batch back for a delayed retry instead of deleting it', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('insert failed'));
    [1, 2, 3].forEach((n) => fake.push({ n }));

    const consumer = consumeBatch(OPTIONS, handler);
    await waitFor(() => fake.callsTo('ChangeMessageVisibilityBatchCommand').length === 1);
    await consumer.stop();

    expect(deleted()).toEqual([]);
    // The redrive policy, not this code, decides when it goes to the DLQ.
    const [retry] = fake.callsTo('ChangeMessageVisibilityBatchCommand');
    expect(retry.Entries.map((e: Entry) => [e.ReceiptHandle, e.VisibilityTimeout])).toEqual([
      ['r1', 30],
      ['r2', 30],
      ['r3', 30],
    ]);
  });

  it('drops an unparseable message on its own without stalling the batch', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push(undefined, { raw: 'not json' });
    fake.push({ n: 2 });

    const consumer = consumeBatch(OPTIONS, handler);
    await waitFor(() => handler.mock.calls.length === 1);
    await consumer.stop();

    // Retrying it can never succeed, so it is deleted rather than dead-lettered.
    expect(fake.callsTo('DeleteMessageCommand').map((i) => i.ReceiptHandle)).toEqual(['r1']);
    expect(handler).toHaveBeenCalledWith([{ n: 2 }], expect.anything());
  });

  it('hands the handler each event’s metadata alongside its payload', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ n: 1 });

    const consumer = consumeBatch({ ...OPTIONS, batchSize: 1 }, handler);
    await waitFor(() => handler.mock.calls.length === 1);
    await consumer.stop();

    expect(handler).toHaveBeenCalledWith([{ n: 1 }], [expect.objectContaining({ eventId: 'e1' })]);
  });

  it('unwraps an SNS envelope when the subscription lacks raw delivery', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ n: 1 }, { snsEnvelope: true });

    const consumer = consumeBatch({ ...OPTIONS, batchSize: 1 }, handler);
    await waitFor(() => handler.mock.calls.length === 1);
    await consumer.stop();

    expect(handler).toHaveBeenCalledWith([{ n: 1 }], expect.anything());
    expect(deleted()).toEqual(['r1']);
  });

  it('drops events of a type it does not handle instead of writing them', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ n: 1 }, { eventType: 'email.send.requested' });
    fake.push({ n: 2 }, { eventType: 'analytics.event.recorded' });

    const consumer = consumeBatch(
      { ...OPTIONS, batchSize: 1, eventTypes: ['analytics.event.recorded'] },
      handler,
    );
    await waitFor(() => handler.mock.calls.length === 1 && deleted().length === 2);
    await consumer.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([{ n: 2 }], expect.anything());
    expect(fake.callsTo('DeleteMessageCommand').map((i) => i.ReceiptHandle)).toEqual(['r1']);
  });

  it('deletes a batch larger than ten in SQS-sized chunks', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    for (let n = 1; n <= 12; n++) fake.push({ n });

    const consumer = consumeBatch({ ...OPTIONS, batchSize: 12 }, handler);
    await waitFor(() => handler.mock.calls.length === 1);
    await consumer.stop();

    expect(handler.mock.calls[0][0]).toHaveLength(12);
    expect(fake.callsTo('DeleteMessageBatchCommand').map((i) => i.Entries.length)).toEqual([10, 2]);
  });

  it('writes what is buffered when stopped, rather than leaving it hidden', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ n: 1 });

    const consumer = consumeBatch({ ...OPTIONS, flushIntervalMs: 60_000 }, handler);
    await waitFor(() => fake.pending.length === 0);
    await consumer.stop();

    expect(handler).toHaveBeenCalledWith([{ n: 1 }], expect.anything());
    expect(deleted()).toEqual(['r1']);
  });

  it('reports healthy status and tracks lastSuccessfulReceiveAt', async () => {
    fake.push({ n: 1 });
    const consumer = consumeBatch(OPTIONS, jest.fn().mockResolvedValue(undefined));
    await waitFor(() => fake.pending.length === 0);

    const status = consumer.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.queueUrl).toBe(OPTIONS.queueUrl);
    expect(status.lastSuccessfulReceiveAt).toBeInstanceOf(Date);
    expect(status.lastError).toBeNull();
    expect(status.consecutiveErrors).toBe(0);

    await consumer.stop();
  });

  it('marks consumer unhealthy after 3 consecutive receive errors and records last error', async () => {
    let failCount = 0;
    fake.send.mockImplementation(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'ReceiveMessageCommand') {
        failCount += 1;
        if (failCount <= 3) {
          throw new Error('AccessDenied: cannot read batch queue');
        }
        await new Promise((r) => setTimeout(r, 10));
        return { Messages: [] };
      }
      return {};
    });

    const consumer = consumeBatch({ ...OPTIONS, receiveErrorBackoffMs: 5 }, jest.fn());

    await waitFor(() => consumer.getStatus().consecutiveErrors >= 3);
    const unhealthyStatus = consumer.getStatus();
    expect(unhealthyStatus.healthy).toBe(false);
    expect(unhealthyStatus.consecutiveErrors).toBe(3);
    expect(unhealthyStatus.lastError).toContain('AccessDenied');
    expect(unhealthyStatus.lastErrorAt).toBeInstanceOf(Date);

    // Recovers once receive succeeds
    await waitFor(() => consumer.getStatus().healthy === true);
    const recoveredStatus = consumer.getStatus();
    expect(recoveredStatus.healthy).toBe(true);
    expect(recoveredStatus.consecutiveErrors).toBe(0);
    expect(recoveredStatus.lastSuccessfulReceiveAt).toBeInstanceOf(Date);

    await consumer.stop();
  });

  it('marks consumer unhealthy when receive has timed out beyond healthThresholdMs', async () => {
    let release!: (v?: any) => void;
    fake.send.mockImplementationOnce(
      () =>
        new Promise<any>((r) => {
          release = r;
        }),
    );
    const consumer = consumeBatch({ ...OPTIONS, healthThresholdMs: 30 }, jest.fn());
    await new Promise((r) => setTimeout(r, 50));

    const status = consumer.getStatus();
    expect(status.healthy).toBe(false);

    release({ Messages: [] });
    await consumer.stop();
  });
});
