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
});
