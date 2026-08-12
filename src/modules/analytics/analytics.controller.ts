import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import AnalyticsService from './analytics.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { ANALYTICSEVENTTYPE } from './analytics.types';

/** Guards against a single request trying to write an unbounded batch. */
const MAX_EVENTS_PER_REQUEST = 50;

const eventSchema = Joi.object({
  eventType: Joi.string()
    .valid(...Object.values(ANALYTICSEVENTTYPE))
    .required(),
  sessionId: Joi.string().max(64).optional(),
  storeId: Joi.string().max(64).optional(),
  productId: Joi.string().max(64).optional(),
  categoryId: Joi.string().max(64).optional(),
  metadata: Joi.object().unknown(true).optional(),
  occurredAt: Joi.string().isoDate().optional(),
});

// One endpoint takes either shape: a bare event, or { events: [...] }. Clients
// batch page-view bursts; a single interaction should not have to.
const bodySchema = Joi.alternatives().try(
  eventSchema,
  Joi.object({
    events: Joi.array().items(eventSchema).min(1).max(MAX_EVENTS_PER_REQUEST).required(),
  }),
);

export default class AnalyticsController {
  /**
   * POST /v1/analytics/events
   *
   * Returns 202 rather than 201: the events have been accepted, but at this
   * point they are usually still on the queue and not yet rows in the table.
   */
  static async record(req: Request, res: Response, next: NextFunction) {
    const { error, value } = bodySchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    const events = 'events' in value ? value.events : [value];

    try {
      const result = await AnalyticsService.record(events, {
        // Authentication is optional on this route; anonymous events are the
        // normal case and are tied together by the client's sessionId instead.
        userId: (req.user as { id: string } | undefined)?.id ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });

      return responseSuccess(res, 202, result, 'Events accepted');
    } catch (err) {
      next(err);
    }
  }
}
