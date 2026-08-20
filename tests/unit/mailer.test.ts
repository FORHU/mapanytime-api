import { renderTemplate } from '../../src/utils/mailer';

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/**
 * The deploy workflows and `.env.example` both plumb `MAILER_*` through, but
 * only `SMTP_*` was ever read, so the mail configuration CI wrote went nowhere.
 * `config.ts` now resolves either spelling to the same values.
 */
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

  // A store name or display name carrying markup must not become markup in
  // someone's inbox.
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
