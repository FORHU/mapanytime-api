import type { Request } from 'express';
import { clientIp } from '../../src/utils/client-ip.util';

const req = (headers: Record<string, string | string[]>, ip?: string) =>
  ({ headers, ip }) as unknown as Request;

describe('clientIp', () => {
  it('prefers the Cloudflare-supplied visitor IP over the edge address in req.ip', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.7' }, '172.70.1.1'))).toBe('203.0.113.7');
  });

  it('takes the first value if the header is repeated', () => {
    expect(
      clientIp(req({ 'cf-connecting-ip': ['203.0.113.7', '198.51.100.2'] }, '172.70.1.1')),
    ).toBe('203.0.113.7');
  });

  it('falls back to req.ip without Cloudflare in front (dev, tests)', () => {
    expect(clientIp(req({}, '127.0.0.1'))).toBe('127.0.0.1');
  });

  it('falls back to req.ip when the header is blank', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '  ' }, '127.0.0.1'))).toBe('127.0.0.1');
  });
});
