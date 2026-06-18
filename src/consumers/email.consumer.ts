import nodemailer from "nodemailer";
import { rabbitmq } from "../infrastructure/rabbitmq";
import { ROUTING_KEYS } from "../events/routing-keys";
import logger from "../utils/logger";
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } from "../config";

interface EmailPayload {
  userId: string;
  email: string;
  subject: string;
  body: string;
}

// Configure Nodemailer for Ethereal (or your production SMTP)
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465, false for other ports
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export const startEmailConsumer = async () => {
  const QUEUE_NAME = "email.queue";

  await rabbitmq.consume<EmailPayload>(
    QUEUE_NAME,
    ROUTING_KEYS.EMAIL_SEND_REQUESTED,
    async (payload) => {
      logger.info(`[EmailConsumer] Sending email to ${payload.email}...`);

      try {
        const info = await transporter.sendMail({
          from: '"API System" <noreply@example.com>',
          to: payload.email,
          subject: payload.subject,
          text: payload.body,
        });

        logger.info(
          `[EmailConsumer] Successfully sent email to ${payload.email}. Message ID: ${info.messageId}`,
        );

        // Ethereal specific - output URL to view the message
        if (SMTP_HOST.includes("ethereal")) {
          logger.info(
            `[EmailConsumer] Ethereal Preview URL: ${nodemailer.getTestMessageUrl(info)}`,
          );
        }
      } catch (error) {
        logger.error(
          `[EmailConsumer] Failed to send email to ${payload.email}`,
          error,
        );
        throw error; // Throwing triggers the RabbitMQ retry and DLQ logic
      }
    },
  );
};
