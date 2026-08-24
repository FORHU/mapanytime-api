/**
 * Validation bounds for money columns.
 *
 * Every currency column in schema.prisma is `@db.Decimal(12, 2)`. Postgres
 * rejects anything that rounds to an absolute value >= 10^10 with SQLSTATE
 * 22003 ("numeric field overflow"), which Prisma surfaces as an unknown
 * request error — i.e. a 500, not a 400. Validating at the edge keeps an
 * out-of-range price a client error where it belongs.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   import { money } from "../helpers/money.helper";
 *
 *   const schema = Joi.object({
 *     price: money().required(),
 *     costPrice: money().optional(),
 *   });
 *
 * `.precision(2)` rounds rather than rejects under Joi's default
 * `convert: true`, so 19.999 is stored as 20.00 instead of 500ing on the
 * scale overflow.
 */

import Joi from 'joi';

/** Largest value a Decimal(12, 2) column can hold. */
export const MAX_MONEY = 9_999_999_999.99;

/** A non-negative amount that fits a Decimal(12, 2) column. */
export const money = (): Joi.NumberSchema =>
  Joi.number().min(0).max(MAX_MONEY).precision(2);
