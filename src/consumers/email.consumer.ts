import { eventBus } from '../infrastructure/event-bus';
import { runOnce } from '../infrastructure/event-bus/idempotency';
import { EMAIL_SEND_QUEUE_URL } from '../config';
import { ROUTING_KEYS } from '../events/routing-keys';
import logger from '../utils/logger';
import { sendEmail, sendTemplatedEmail } from '../utils/mailer';

/**
 * An email to send. Either `templateName` + `data` (rendered from
 * `email-template/`), or a plain `body`. `body` doubles as the plain-text
 * alternative when a template is used.
 */
export interface EmailPayload {
  userId: string;
  email: string;
  subject: string;
  body?: string;
  templateName?: string;
  data?: Record<string, string | number>;
}

const send = async (payload: EmailPayload): Promise<void> => {
  logger.info(`[EmailConsumer] Sending "${payload.subject}" to ${payload.email}...`);

  try {
    if (payload.templateName) {
      await sendTemplatedEmail({
        to: payload.email,
        subject: payload.subject,
        templateName: payload.templateName,
        data: payload.data ?? {},
        text: payload.body,
      });
    } else {
      await sendEmail({
        to: payload.email,
        subject: payload.subject,
        text: payload.body,
      });
    }
  } catch (error) {
    logger.error(`[EmailConsumer] Failed to send email to ${payload.email}`, error);
    throw error; // Throwing leaves it on the queue to retry, then the DLQ
  }
};

/**
 * Receives `email.send.requested` through its SNS subscription filter.
 *
 * SQS can deliver an event more than once, so each send goes through `runOnce`
 * keyed by the event id: a redelivery is skipped rather than emailed twice.
 */
export const startEmailConsumer = () =>
  eventBus.consume<EmailPayload>(
    EMAIL_SEND_QUEUE_URL,
    async (payload, metadata) => {
      if (!metadata?.eventId) return send(payload);
      await runOnce(`email:${metadata.eventId}`, () => send(payload));
    },
    { eventTypes: [ROUTING_KEYS.EMAIL_SEND_REQUESTED] },
  );
