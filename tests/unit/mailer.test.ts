import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import logger from '../../src/utils/logger';
import {
  getSesClient,
  isMailerConfigured,
  renderTemplate,
  resetTransporter,
  sendEmail,
  sendTemplatedEmail,
  verifyMailer,
} from '../../src/utils/mailer';

const mockSendMail = jest.fn();
const mockVerify = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
    verify: mockVerify,
  })),
  getTestMessageUrl: jest.fn(() => 'https://ethereal.email/message/test-id'),
}));

jest.mock('@aws-sdk/client-sesv2', () => {
  return {
    SESv2Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    SendEmailCommand: jest.fn().mockImplementation((input: unknown) => input),
  };
});

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockConfig = {
  MAIL_DRIVER: 'smtp',
  AWS_SES_ENDPOINT: '',
  AWS_SES_REGION: 'ap-southeast-1',
  MAILER_TRANSPORT_HOST: 'smtp.ethereal.email',
  MAILER_TRANSPORT_PORT: 587,
  MAILER_TRANSPORT_SECURE: false,
  MAILER_EMAIL: 'test@example.com',
  MAILER_PASSWORD: 'secretpassword',
  MAILER_FROM_NAME: 'MapAnytime',
};

jest.mock('../../src/config', () => ({
  get MAIL_DRIVER() {
    return mockConfig.MAIL_DRIVER;
  },
  get AWS_SES_ENDPOINT() {
    return mockConfig.AWS_SES_ENDPOINT;
  },
  get AWS_SES_REGION() {
    return mockConfig.AWS_SES_REGION;
  },
  get MAILER_TRANSPORT_HOST() {
    return mockConfig.MAILER_TRANSPORT_HOST;
  },
  get MAILER_TRANSPORT_PORT() {
    return mockConfig.MAILER_TRANSPORT_PORT;
  },
  get MAILER_TRANSPORT_SECURE() {
    return mockConfig.MAILER_TRANSPORT_SECURE;
  },
  get MAILER_EMAIL() {
    return mockConfig.MAILER_EMAIL;
  },
  get MAILER_PASSWORD() {
    return mockConfig.MAILER_PASSWORD;
  },
  get MAILER_FROM_NAME() {
    return mockConfig.MAILER_FROM_NAME;
  },
}));

describe('renderTemplate', () => {
  it('substitutes every placeholder in the password reset template', () => {
    const html = renderTemplate('password-reset.html', {
      firstName: 'Dev',
      code: '4827',
      expiryMinutes: 15,
    });

    expect(html).toContain('4827');
    expect(html).toContain('Dev');
    expect(html).toContain('15 minutes');
    expect(html.match(/{{\s*\w+\s*}}/g)).toBeNull();
  });

  it('escapes HTML in substituted values', () => {
    const html = renderTemplate('password-reset.html', {
      firstName: '<script>alert(1)</script>',
      code: '0000',
      expiryMinutes: 15,
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('substitutes every occurrence, not just the first', () => {
    const html = renderTemplate('password-reset.html', {
      firstName: 'Dev',
      code: 'REPEATED',
      expiryMinutes: 15,
    });

    expect(html).not.toContain('{{code}}');
  });
});

describe('mailer transport driver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTransporter();
    mockConfig.MAIL_DRIVER = 'smtp';
    mockConfig.AWS_SES_ENDPOINT = '';
    mockConfig.AWS_SES_REGION = 'ap-southeast-1';
    mockConfig.MAILER_TRANSPORT_HOST = 'smtp.ethereal.email';
    mockConfig.MAILER_TRANSPORT_PORT = 587;
    mockConfig.MAILER_TRANSPORT_SECURE = false;
    mockConfig.MAILER_EMAIL = 'test@example.com';
    mockConfig.MAILER_PASSWORD = 'secretpassword';
    mockConfig.MAILER_FROM_NAME = 'MapAnytime';
    mockVerify.mockResolvedValue(true);
    mockSendMail.mockResolvedValue({ messageId: 'msg-12345' });
  });

  describe('isMailerConfigured', () => {
    it('returns true when SMTP credentials and host are present', () => {
      mockConfig.MAIL_DRIVER = 'smtp';
      expect(isMailerConfigured()).toBe(true);
    });

    it('returns false when SMTP password or host is missing', () => {
      mockConfig.MAIL_DRIVER = 'smtp';
      mockConfig.MAILER_PASSWORD = '';
      expect(isMailerConfigured()).toBe(false);

      mockConfig.MAILER_PASSWORD = 'pass';
      mockConfig.MAILER_TRANSPORT_HOST = '';
      expect(isMailerConfigured()).toBe(false);
    });

    it('returns true for SES driver when MAILER_EMAIL is present', () => {
      mockConfig.MAIL_DRIVER = 'ses';
      mockConfig.MAILER_EMAIL = 'noreply@mapanytime.com';
      mockConfig.MAILER_PASSWORD = ''; // SES does not require SMTP password
      mockConfig.MAILER_TRANSPORT_HOST = '';
      expect(isMailerConfigured()).toBe(true);
    });

    it('returns false for SES driver when MAILER_EMAIL is missing', () => {
      mockConfig.MAIL_DRIVER = 'ses';
      mockConfig.MAILER_EMAIL = '';
      expect(isMailerConfigured()).toBe(false);
    });
  });

  describe('verifyMailer', () => {
    it('returns false and logs warning when unconfigured in SMTP mode', async () => {
      mockConfig.MAIL_DRIVER = 'smtp';
      mockConfig.MAILER_EMAIL = '';

      const verified = await verifyMailer();
      expect(verified).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MAILER_TRANSPORT_HOST / MAILER_EMAIL / MAILER_PASSWORD'),
      );
    });

    it('returns false and logs warning when unconfigured in SES mode', async () => {
      mockConfig.MAIL_DRIVER = 'ses';
      mockConfig.MAILER_EMAIL = '';

      const verified = await verifyMailer();
      expect(verified).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('MAILER_EMAIL is required for AWS SES transport'),
      );
    });

    it('successfully verifies SMTP transport', async () => {
      mockConfig.MAIL_DRIVER = 'smtp';
      const verified = await verifyMailer();
      expect(verified).toBe(true);
      expect(mockVerify).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Transport verified: test@example.com'),
      );
    });

    it('successfully verifies SES transport', async () => {
      mockConfig.MAIL_DRIVER = 'ses';
      mockConfig.MAILER_EMAIL = 'ses-sender@mapanytime.com';

      const verified = await verifyMailer();
      expect(verified).toBe(true);
      expect(mockVerify).toHaveBeenCalled();
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          SES: expect.objectContaining({
            SendEmailCommand,
          }),
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('AWS SES transport verified for ses-sender@mapanytime.com'),
      );
    });

    it('handles verification error gracefully in SES mode without throwing', async () => {
      mockConfig.MAIL_DRIVER = 'ses';
      mockConfig.MAILER_EMAIL = 'ses-sender@mapanytime.com';
      mockVerify.mockRejectedValueOnce(new Error('SES IAM Access Denied'));

      const verified = await verifyMailer();
      expect(verified).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('AWS SES transport check FAILED'),
        expect.any(Error),
      );
    });

    it('handles verification error gracefully in SMTP mode without throwing', async () => {
      mockConfig.MAIL_DRIVER = 'smtp';
      mockVerify.mockRejectedValueOnce(new Error('Connection refused'));

      const verified = await verifyMailer();
      expect(verified).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Transport check FAILED'),
        expect.any(Error),
      );
    });
  });

  describe('sendEmail', () => {
    it('throws if transport is not configured', async () => {
      mockConfig.MAILER_EMAIL = '';
      await expect(sendEmail({ to: 'user@example.com', subject: 'Test' })).rejects.toThrow(
        'Refusing to send: mail transport is not configured',
      );
    });

    it('dispatches email via SMTP transporter with correct parameters', async () => {
      mockConfig.MAIL_DRIVER = 'smtp';
      mockConfig.MAILER_TRANSPORT_HOST = 'smtp.ethereal.email';

      const id = await sendEmail({
        to: 'buyer@example.com',
        subject: 'Order Confirmation',
        text: 'Your order is confirmed.',
        html: '<p>Your order is confirmed.</p>',
        cc: 'orders@mapanytime.com',
      });

      expect(id).toBe('msg-12345');
      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'MapAnytime <test@example.com>',
        to: 'buyer@example.com',
        subject: 'Order Confirmation',
        text: 'Your order is confirmed.',
        html: '<p>Your order is confirmed.</p>',
        cc: 'orders@mapanytime.com',
      });
      expect(nodemailer.getTestMessageUrl).toHaveBeenCalled();
    });

    it('dispatches email via SES transporter when MAIL_DRIVER=ses', async () => {
      mockConfig.MAIL_DRIVER = 'ses';
      mockConfig.MAILER_EMAIL = 'support@mapanytime.com';

      const id = await sendEmail({
        to: 'seller@example.com',
        subject: 'Payout Processed',
        html: '<p>Funds released.</p>',
      });

      expect(id).toBe('msg-12345');
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          SES: expect.objectContaining({
            SendEmailCommand,
          }),
        }),
      );
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'MapAnytime <support@mapanytime.com>',
          to: 'seller@example.com',
          subject: 'Payout Processed',
          html: '<p>Funds released.</p>',
        }),
      );
    });

    it('sends templated email', async () => {
      mockConfig.MAIL_DRIVER = 'ses';
      const id = await sendTemplatedEmail({
        to: 'user@example.com',
        subject: 'Reset Password',
        templateName: 'password-reset.html',
        data: { firstName: 'Alice', code: '1234', expiryMinutes: 10 },
      });

      expect(id).toBe('msg-12345');
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Reset Password',
          html: expect.stringContaining('1234'),
        }),
      );
    });
  });

  describe('getSesClient', () => {
    it('creates client with local credentials when AWS_SES_ENDPOINT is set', () => {
      mockConfig.AWS_SES_ENDPOINT = 'http://localhost:4566';
      resetTransporter();

      const client = getSesClient();
      expect(client).toBeDefined();
      expect(SESv2Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'http://localhost:4566',
          region: 'ap-southeast-1',
          credentials: expect.objectContaining({
            accessKeyId: expect.any(String),
            secretAccessKey: expect.any(String),
          }),
        }),
      );
    });

    it('creates client using IAM role provider chain (no credentials object) when endpoint is unset', () => {
      mockConfig.AWS_SES_ENDPOINT = '';
      resetTransporter();

      const client = getSesClient();
      expect(client).toBeDefined();
      expect(SESv2Client).toHaveBeenCalledWith({
        region: 'ap-southeast-1',
      });
    });
  });
});
