import fs from 'fs';
import path from 'path';
import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';
import {
  MAILER_EMAIL,
  MAILER_FROM_NAME,
  MAILER_PASSWORD,
  MAILER_TRANSPORT_HOST,
  MAILER_TRANSPORT_PORT,
  MAILER_TRANSPORT_SECURE,
} from '../config';
import logger from './logger';

/**
 * One transporter for the process, not one per message.
 *
 * Nodemailer pools and reuses the underlying connection; building a fresh
 * transport on every send throws that away and reopens an SMTP connection for
 * each email.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: MAILER_TRANSPORT_HOST,
      port: MAILER_TRANSPORT_PORT,
      secure: MAILER_TRANSPORT_SECURE,
      auth: MAILER_EMAIL ? { user: MAILER_EMAIL, pass: MAILER_PASSWORD } : undefined,
    });
  }
  return transporter;
}

/** True when enough is configured for a send to have any chance of working. */
export function isMailerConfigured(): boolean {
  return Boolean(MAILER_TRANSPORT_HOST && MAILER_EMAIL && MAILER_PASSWORD);
}

/**
 * Check the mail transport at startup rather than discovering it is broken the
 * first time someone locks themselves out of their account.
 *
 * Never throws: mail being down is not a reason for the worker to refuse to
 * start, but it is very much a reason to say so loudly in the log.
 */
export async function verifyMailer(): Promise<boolean> {
  if (!isMailerConfigured()) {
    logger.warn(
      '[Mailer] Not configured — MAILER_TRANSPORT_HOST / MAILER_EMAIL / MAILER_PASSWORD ' +
        'are incomplete. Password reset codes and every other email will fail to send.',
    );
    return false;
  }

  try {
    await getTransporter().verify();
    logger.info(
      `[Mailer] Transport verified: ${MAILER_EMAIL} via ${MAILER_TRANSPORT_HOST}:${MAILER_TRANSPORT_PORT}`,
    );
    return true;
  } catch (error) {
    logger.error(
      `[Mailer] Transport check FAILED for ${MAILER_TRANSPORT_HOST}:${MAILER_TRANSPORT_PORT} — ` +
        'emails will not be delivered.',
      error,
    );
    return false;
  }
}

/**
 * Send one email. Credentials are never logged — the address is enough to trace
 * a delivery, and the password is not.
 */
export async function sendEmail({
  to,
  subject,
  text,
  html,
  cc,
}: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string | null;
}): Promise<string> {
  if (!isMailerConfigured()) {
    throw new Error(
      '[Mailer] Refusing to send: mail transport is not configured. ' +
        'Set MAILER_TRANSPORT_HOST, MAILER_EMAIL and MAILER_PASSWORD.',
    );
  }

  const mailOptions: SendMailOptions = {
    from: `${MAILER_FROM_NAME} <${MAILER_EMAIL}>`,
    to,
    subject,
  };

  if (text) mailOptions.text = text;
  if (html) mailOptions.html = html;
  if (cc) mailOptions.cc = cc;

  const info = await getTransporter().sendMail(mailOptions);
  logger.info(`[Mailer] Sent "${subject}" to ${to} (id: ${info.messageId})`);

  // Ethereal is the default dev transport and delivers nowhere real; the
  // preview URL is the only way to see what was sent.
  if (MAILER_TRANSPORT_HOST.includes('ethereal')) {
    logger.info(`[Mailer] Ethereal preview: ${nodemailer.getTestMessageUrl(info)}`);
  }

  return info.messageId;
}

const templateCache = new Map<string, string>();

/**
 * Read an HTML template from `email-template/` and substitute `{{key}}`
 * placeholders.
 *
 * Values are HTML-escaped: a reset code or a store name interpolated raw would
 * let anything that reaches these fields inject markup into the email body.
 */
export function renderTemplate(
  templateName: string,
  data: Record<string, string | number>,
): string {
  let html = templateCache.get(templateName);

  if (!html) {
    const filePath = path.join(process.cwd(), 'email-template', templateName);
    html = fs.readFileSync(filePath, 'utf8');
    if (process.env.NODE_ENV === 'production') templateCache.set(templateName, html);
  }

  for (const [key, value] of Object.entries(data)) {
    html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), escapeHtml(String(value)));
  }

  return html;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a template and send it in one step. */
export async function sendTemplatedEmail({
  to,
  subject,
  templateName,
  data,
  text,
  cc,
}: {
  to: string;
  subject: string;
  templateName: string;
  data: Record<string, string | number>;
  /** Plain-text alternative, for clients that will not render HTML. */
  text?: string;
  cc?: string | null;
}): Promise<string> {
  return sendEmail({ to, subject, html: renderTemplate(templateName, data), text, cc });
}
