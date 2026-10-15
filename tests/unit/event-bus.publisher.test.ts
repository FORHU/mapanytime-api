const send = jest.fn();

jest.mock('../../src/infrastructure/event-bus/clients', () => ({
  sns: { send: (command: never) => send(command) },
  sqs: { send: jest.fn() },
}));

const TOPIC = 'arn:aws:sns:ap-southeast-1:000000000000:mapanytime-events';

type Publisher = typeof import('../../src/infrastructure/event-bus/publisher');

/** Load the publisher with a given EVENTS_TOPIC_ARN; config reads it at import. */
const loadPublisher = (topicArn: string): Publisher => {
  process.env.EVENTS_TOPIC_ARN = topicArn;
  let publisher!: Publisher;
  jest.isolateModules(() => {
    publisher = require('../../src/infrastructure/event-bus/publisher');
  });
  return publisher;
};
const loadPublish = (topicArn: string) => loadPublisher(topicArn).publish;

const ORIGINAL = process.env.EVENTS_TOPIC_ARN;

beforeEach(() => send.mockReset());
afterAll(() => {
  process.env.EVENTS_TOPIC_ARN = ORIGINAL;
});

describe('publish', () => {
  it('sends the event to the topic with its routing key as the eventType attribute', async () => {
    send.mockResolvedValue({ MessageId: 'x' });
    const publish = loadPublish(TOPIC);

    await expect(publish('email.send.requested', { email: 'a@example.com' })).resolves.toBe(true);

    const { input } = send.mock.calls[0][0];
    expect(input.TopicArn).toBe(TOPIC);
    // Each queue's subscription filter policy matches on this attribute.
    expect(input.MessageAttributes).toEqual({
      eventType: { DataType: 'String', StringValue: 'email.send.requested' },
    });
    const body = JSON.parse(input.Message);
    expect(body.payload).toEqual({ email: 'a@example.com' });
    expect(body.metadata).toMatchObject({ eventType: 'email.send.requested', version: '1' });
  });

  it('returns false instead of throwing when SNS rejects', async () => {
    send.mockRejectedValue(new Error('throttled'));
    const publish = loadPublish(TOPIC);

    await expect(publish('user.created', {})).resolves.toBe(false);
  });

  it('returns false without calling SNS when no topic is configured', async () => {
    const publish = loadPublish('');

    await expect(publish('user.created', {})).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('publishMany', () => {
  /** Answer each PublishBatch with the given entry ids failed, the rest successful. */
  const batchReply =
    (failedIds: string[] = []) =>
    async (command: { input: { PublishBatchRequestEntries: Array<{ Id: string }> } }) => {
      const ids = command.input.PublishBatchRequestEntries.map((e) => e.Id);
      return {
        Successful: ids.filter((id) => !failedIds.includes(id)).map((Id) => ({ Id })),
        Failed: failedIds.filter((id) => ids.includes(id)).map((Id) => ({ Id, Code: 'X' })),
      };
    };

  it('sends ten events per call, each tagged with its eventType', async () => {
    send.mockImplementation(batchReply());
    const { publishMany } = loadPublisher(TOPIC);

    const payloads = Array.from({ length: 23 }, (_, i) => ({ i }));
    const results = await publishMany('analytics.event.recorded', payloads);

    expect(results).toEqual(payloads.map(() => true));
    const sizes = send.mock.calls.map(([c]) => c.input.PublishBatchRequestEntries.length);
    expect(sizes).toEqual([10, 10, 3]);
    const entry = send.mock.calls[2][0].input.PublishBatchRequestEntries[2];
    expect(JSON.parse(entry.Message).payload).toEqual({ i: 22 });
    expect(entry.MessageAttributes.eventType.StringValue).toBe('analytics.event.recorded');
  });

  it('reports false for exactly the entries SNS failed', async () => {
    send.mockImplementation(batchReply(['1', '11']));
    const { publishMany } = loadPublisher(TOPIC);

    const results = await publishMany(
      'analytics.event.recorded',
      Array.from({ length: 12 }, () => ({})),
    );

    expect(results.map((ok, i) => (ok ? null : i)).filter((i) => i !== null)).toEqual([1, 11]);
  });

  it('reports a whole chunk false when SNS rejects the call, and keeps going', async () => {
    send.mockRejectedValueOnce(new Error('batch too large')).mockImplementation(batchReply());
    const { publishMany } = loadPublisher(TOPIC);

    const results = await publishMany(
      'analytics.event.recorded',
      Array.from({ length: 12 }, () => ({})),
    );

    expect(results.slice(0, 10).every((ok) => !ok)).toBe(true);
    expect(results.slice(10)).toEqual([true, true]);
  });

  it('returns all false without calling SNS when no topic is configured', async () => {
    const { publishMany } = loadPublisher('');

    await expect(publishMany('analytics.event.recorded', [{}, {}])).resolves.toEqual([
      false,
      false,
    ]);
    expect(send).not.toHaveBeenCalled();
  });
});
