import { consume } from '../../src/infrastructure/event-bus/consumer';
import { getContext } from '../../src/utils/async-context';
import { makeFakeSqs, waitFor } from '../helpers/fake-sqs';

const fake = makeFakeSqs();

jest.mock('../../src/infrastructure/event-bus/clients', () => ({
  sqs: { send: (command: never) => fake.send(command) },
  sns: { send: jest.fn() },
}));

const QUEUE = 'http://localhost:4566/000000000000/test-queue';

beforeEach(() => fake.reset());

describe('consume', () => {
  it('deletes a message once its handler resolves', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ to: 'a@example.com' });

    const consumer = consume(QUEUE, handler);
    await waitFor(() => fake.callsTo('DeleteMessageCommand').length === 1);
    await consumer.stop();

    expect(handler).toHaveBeenCalledWith(
      { to: 'a@example.com' },
      expect.objectContaining({ eventId: 'e1' }),
    );
    expect(fake.callsTo('DeleteMessageCommand')[0].ReceiptHandle).toBe('r1');
  });

  it('runs the handler in the publisher’s correlation context', async () => {
    let seen: ReturnType<typeof getContext>;
    fake.push({});

    const consumer = consume(QUEUE, async () => {
      seen = getContext();
    });
    await waitFor(() => fake.callsTo('DeleteMessageCommand').length === 1);
    await consumer.stop();

    expect(seen).toEqual({ correlationId: 'corr-1', requestId: 'req-1' });
  });

  it('leaves a failed message for a delayed retry instead of deleting it', async () => {
    fake.push({});

    const consumer = consume(QUEUE, jest.fn().mockRejectedValue(new Error('smtp down')), {
      retryDelaySeconds: 30,
    });
    await waitFor(() => fake.callsTo('ChangeMessageVisibilityCommand').length === 1);
    await consumer.stop();

    expect(fake.callsTo('DeleteMessageCommand')).toEqual([]);
    expect(fake.callsTo('ChangeMessageVisibilityCommand')[0]).toMatchObject({
      ReceiptHandle: 'r1',
      VisibilityTimeout: 30,
    });
  });

  it('drops an unparseable message without calling the handler', async () => {
    const handler = jest.fn();
    fake.push(undefined, { raw: '{"not": "an event"' });

    const consumer = consume(QUEUE, handler);
    await waitFor(() => fake.callsTo('DeleteMessageCommand').length === 1);
    await consumer.stop();

    expect(handler).not.toHaveBeenCalled();
  });

  it('unwraps an SNS envelope when the subscription lacks raw delivery', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ to: 'a@example.com' }, { snsEnvelope: true });

    const consumer = consume(QUEUE, handler);
    await waitFor(() => fake.callsTo('DeleteMessageCommand').length === 1);
    await consumer.stop();

    expect(handler).toHaveBeenCalledWith(
      { to: 'a@example.com' },
      expect.objectContaining({ eventId: 'e1' }),
    );
  });

  it('drops an event of a type it does not handle, without retrying it', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    fake.push({ n: 1 }, { eventType: 'analytics.event.recorded' });
    fake.push({ n: 2 }, { eventType: 'email.send.requested' });

    const consumer = consume(QUEUE, handler, { eventTypes: ['email.send.requested'] });
    await waitFor(() => fake.callsTo('DeleteMessageCommand').length === 2);
    await consumer.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ n: 2 }, expect.anything());
    expect(fake.callsTo('ChangeMessageVisibilityCommand')).toEqual([]);
  });

  it('receives only as many messages as it can run at once', async () => {
    const consumer = consume(QUEUE, jest.fn(), { concurrency: 25 });
    await waitFor(() => fake.callsTo('ReceiveMessageCommand').length >= 1);
    await consumer.stop();

    // SQS caps a receive at ten.
    expect(fake.callsTo('ReceiveMessageCommand')[0].MaxNumberOfMessages).toBe(10);
  });

  it('waits for the running message before stop resolves', async () => {
    let release!: () => void;
    fake.push({});
    const consumer = consume(
      QUEUE,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await waitFor(() => release !== undefined);

    let stopped = false;
    const stopping = consumer.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(fake.callsTo('DeleteMessageCommand').map((i) => i.ReceiptHandle)).toEqual(['r1']);
  });

  it('hands back messages received while stopping', async () => {
    const handler = jest.fn();
    // Hold the first receive open, as a long poll would, until stop() is called.
    let openPoll!: (value: unknown) => void;
    fake.send.mockImplementationOnce(async (command: Parameters<typeof fake.send>[0]) => {
      fake.calls.push({ name: command.constructor.name, input: command.input });
      await new Promise((r) => (openPoll = r));
      return {
        Messages: [{ MessageId: 'late', ReceiptHandle: 'r-late', Body: '{"payload":{}}' }],
      };
    });

    const consumer = consume(QUEUE, handler);
    await waitFor(() => openPoll !== undefined);
    const stopping = consumer.stop();
    openPoll(undefined);
    await stopping;

    expect(handler).not.toHaveBeenCalled();
    expect(fake.callsTo('ChangeMessageVisibilityCommand')[0]).toMatchObject({
      ReceiptHandle: 'r-late',
      VisibilityTimeout: 0,
    });
  });

  it('reports healthy status and tracks lastSuccessfulReceiveAt', async () => {
    fake.push({ to: 'a@example.com' });
    const consumer = consume(QUEUE, jest.fn().mockResolvedValue(undefined));
    await waitFor(() => fake.callsTo('DeleteMessageCommand').length === 1);

    const status = consumer.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.queueUrl).toBe(QUEUE);
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
          throw new Error('AccessDenied: cannot read queue');
        }
        await new Promise((r) => setTimeout(r, 10));
        return { Messages: [] };
      }
      return {};
    });

    const consumer = consume(QUEUE, jest.fn(), { receiveErrorBackoffMs: 5 });

    await waitFor(() => consumer.getStatus().consecutiveErrors >= 3);
    const unhealthyStatus = consumer.getStatus();
    expect(unhealthyStatus.healthy).toBe(false);
    expect(unhealthyStatus.consecutiveErrors).toBe(3);
    expect(unhealthyStatus.lastError).toContain('AccessDenied');
    expect(unhealthyStatus.lastErrorAt).toBeInstanceOf(Date);

    // After failure count > 3, it succeeds and recovers
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
    const consumer = consume(QUEUE, jest.fn(), { healthThresholdMs: 30 });
    await new Promise((r) => setTimeout(r, 50));

    const status = consumer.getStatus();
    expect(status.healthy).toBe(false);

    release({ Messages: [] });
    await consumer.stop();
  });
});
