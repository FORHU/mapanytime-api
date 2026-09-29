import type { Request } from 'express';

/**
 * The visitor's real IP address.
 *
 * Prod sits behind Cloudflare, so with `trust proxy` set to 1 `req.ip` is a
 * Cloudflare edge address that many users share, and it changes from request to
 * request. Rate limiting keyed on it pooled everyone behind the same edge into
 * one budget, so users got 429s for traffic that wasn't theirs.
 * Cloudflare sets `CF-Connecting-IP` to the real client and overwrites any value
 * the client sent. This relies on the origin being reachable only through
 * Cloudflare.
 * Anywhere without Cloudflare in front (local dev, tests) falls back to `req.ip`.
 */
export function clientIp(req: Request): string | undefined {
  const header = req.headers['cf-connecting-ip'];
  const cf = Array.isArray(header) ? header[0] : header;
  return cf?.trim() || req.ip;
}
