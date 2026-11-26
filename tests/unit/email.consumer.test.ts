import { startEmailConsumer } from '../../src/consumers/email.consumer';
import { eventBus } from '../../src/infrastructure/event-bus';
import { runOnce } from '../../src/infrastructure/event-bus/idempotency';
import { sendEmail } from '../../src/utils/mailer';
import { ROUTING_KEYS } from '../../src/events/routing-keys';

jest.mock('../../src/infrastructure/event-bus', () => ({
  eventBus: { consume: jest.fn() },
}));

jest.mock('../../src/infrastructure/event-bus/idempotency', () => ({
  runOnce: jest.fn(async (_key: string, fn: () => Promise<void>) => {
    await fn();
    return true;
  }),
}));

jest.mock('../../src/utils/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
  sendTemplatedEmail: jest.fn().mockResolvedValue(undefined),
}));

const consume = eventBus.consume as jest.Mock;

/** Start the consumer and return the handler it registered. */
const registeredHandler = () => {
  startEmailConsumer();
  return consume.mock.calls[0][1] as (payload: unknown, metadata: unknown) => Promise<void>;
};

const payload = { userId: 'u1', email: 'a@example.com', subject: 'Hi', body: 'Hello' };

beforeEach(() => jest.clearAllMocks());

describe('email consumer', () => {
  it('only handles email.send.requested', () => {
    startEmailConsumer();

    expect(consume.mock.calls[0][2]).toMatchObject({
      eventTypes: [ROUTING_KEYS.EMAIL_SEND_REQUESTED],
    });
  });

  it('sends through runOnce keyed by the event id, so a redelivery is not sent twice', async () => {
    await registeredHandler()(payload, { eventId: 'e1' });

    expect(runOnce).toHaveBeenCalledWith('email:e1', expect.any(Function));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('still sends an event that has no id', async () => {
    await registeredHandler()(payload, {});

    expect(runOnce).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
