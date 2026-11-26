import Joi from 'joi';
import { SELLERCAMPAIGNTYPE, CAMPAIGNSTATUS } from '@prisma/client';

export const createCampaignSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required().messages({
    'string.empty': 'Campaign name is required.',
    'any.required': 'Campaign name is required.',
  }),
  storeId: Joi.string().trim().optional().allow(null),
  type: Joi.string()
    .valid(...Object.values(SELLERCAMPAIGNTYPE))
    .default(SELLERCAMPAIGNTYPE.BONUS_POINTS),
  startDate: Joi.date().iso().required().messages({
    'date.base': 'Start date must be a valid date.',
    'any.required': 'Start date is required.',
  }),
  endDate: Joi.date().iso().greater(Joi.ref('startDate')).required().messages({
    'date.greater': 'End date must be after start date.',
    'any.required': 'End date is required.',
  }),
  budgetAmount: Joi.number().positive().min(1).max(1000000).required().messages({
    'number.positive': 'Budget amount must be positive.',
    'any.required': 'Budget amount is required.',
  }),
  bonusPoints: Joi.number().integer().min(1).max(10000).optional(),
  maxRewardPoints: Joi.number().integer().min(1).max(50000).optional().allow(null),
  minOrderAmount: Joi.number().min(0).max(1000000).optional().allow(null),
});

export const updateCampaignSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  status: Joi.string().valid(CAMPAIGNSTATUS.ACTIVE, CAMPAIGNSTATUS.PAUSED).optional(),
  endDate: Joi.date().iso().optional(),
  bonusPoints: Joi.number().integer().min(1).max(10000).optional(),
  maxRewardPoints: Joi.number().integer().min(1).max(50000).optional().allow(null),
  minOrderAmount: Joi.number().min(0).max(1000000).optional().allow(null),
  addBudgetAmount: Joi.number().positive().min(1).max(1000000).optional(),
});
