/* eslint-disable @typescript-eslint/no-explicit-any -- SQS command inputs are asserted loosely in tests */
import type { Message } from '@aws-sdk/client-sqs';

/**
 * An in-memory stand-in for the SQS client's `send`, enough for the event-bus
 * consumers: messages wait in `pending`, a receive takes what fits, and every
 * command is recorded by name so tests can assert on deletes and visibility.
 *
 * An empty receive resolves after `emptyPollMs` of real time instead of the
 * long-poll wait, so the loop keeps turning without the test waiting 20s.
 */
export const makeFakeSqs = ({ emptyPollMs = 5 } = {}) => {
  const pending: Message[] = [];
  const calls: Array<{ name: string; input: any }> = [];
  let seq = 0;

  const send = jest.fn(async (command: { constructor: { name: string }; input: any }) => {
    const name = command.constructor.name;
    calls.push({ name, input: command.input });

    switch (name) {
      case 'ReceiveMessageCommand': {
        if (pending.length === 0) {
          await new Promise((r) => setTimeout(r, emptyPollMs));
          return { Messages: [] };
        }
        return { Messages: pending.splice(0, command.input.MaxNumberOfMessages ?? 1) };
      }
      case 'DeleteMessageBatchCommand':
        return { Successful: command.input.Entries.map((e: { Id: string }) => ({ Id: e.Id })) };
      default:
        return {};
    }
  });

  /**
   * Queue an event the way the publisher writes it, or a raw body. `snsEnvelope`
   * wraps it the way SNS does when a subscription lacks raw message delivery.
   */
  const push = (
    payload: unknown,
    {
      raw,
      eventType,
      eventId,
      snsEnvelope,
    }: { raw?: string; eventType?: string; eventId?: string; snsEnvelope?: boolean } = {},
  ) => {
    seq += 1;
    const event = JSON.stringify({
      metadata: {
        eventId: eventId ?? `e${seq}`,
        eventType,
        correlationId: `corr-${seq}`,
        requestId: `req-${seq}`,
      },
      payload,
    });
    pending.push({
      MessageId: `m${seq}`,
      ReceiptHandle: `r${seq}`,
      Body:
        raw ??
        (snsEnvelope
          ? JSON.stringify({ Type: 'Notification', MessageId: `sns-${seq}`, Message: event })
          : event),
      Attributes: { ApproximateReceiveCount: '1' },
    });
  };

  const callsTo = (name: string) => calls.filter((c) => c.name === name).map((c) => c.input);

  /** Clear messages, recorded calls and the id counter between tests. */
  const reset = () => {
    send.mockClear();
    pending.length = 0;
    calls.length = 0;
    seq = 0;
  };

  return { send, push, pending, calls, callsTo, reset };
};

/** Resolve once `predicate` holds, polling in real time. */
export const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
};
