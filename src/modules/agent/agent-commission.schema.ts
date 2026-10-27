import Joi from 'joi';
import { COMMISSIONBASE } from '@prisma/client';

export const requestPayoutSchema = Joi.object({
  amount: Joi.number().positive().min(500).required().messages({
    'number.min': 'Minimum payout amount is ₱500.00.',
    'any.required': 'Payout amount is required.',
  }),
  paymentMethod: Joi.string().valid('BANK_TRANSFER', 'GCASH', 'MAYA').default('BANK_TRANSFER'),
  reference: Joi.string().trim().max(100).optional().allow('', null),
});

export const updateCommissionConfigSchema = Joi.object({
  commissionRate: Joi.number().positive().min(0.00001).max(0.1).optional().messages({
    'number.max': 'Commission rate cannot exceed 10%.',
  }),
  commissionBase: Joi.string()
    .valid(...Object.values(COMMISSIONBASE))
    .optional(),
  eligibilityHoldDays: Joi.number().integer().min(0).max(60).optional(),
  payoutMinimum: Joi.number().positive().min(50).max(50000).optional(),
  isEnabled: Joi.boolean().optional(),
  changeReason: Joi.string().trim().max(255).optional(),
});
