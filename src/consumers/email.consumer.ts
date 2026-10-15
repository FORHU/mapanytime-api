import { eventBus } from '../infrastructure/event-bus';
import { EMAIL_SEND_QUEUE_URL } from '../config';
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

/** Receives `email.send.requested` through its SNS subscription filter. */
export const startEmailConsumer = () =>
  eventBus.consume<EmailPayload>(EMAIL_SEND_QUEUE_URL, async (payload) => {
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
  });
