import { Router } from 'express';
import {
  getActiveMethods,
  initiatePayment,
  getPaymentStatus,
  handleProviderWebhook,
  handleXenditReturn,
  mockWebhook,
} from './payment.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

const isProduction = process.env.NODE_ENV === 'production';

// Public: the checkout UI needs the method list before anyone has signed in.
router.get('/methods', getActiveMethods);

// Order payment initiation and polling. `authenticate` only says who the caller
// is — the service additionally asserts they are a party to the order.
// See FLAGS.md.
router.post('/orders/:orderId/payment', authenticate, initiatePayment);
router.get('/orders/:orderId/payment', authenticate, getPaymentStatus);

// Where the gateway sends the buyer's browser after paying. Public by
// necessity — that browser holds no bearer token — so the signed `t` on the URL
// is the credential instead. Read-only: it reports what the webhook recorded and
// never settles a payment itself.
router.get('/xendit/return', handleXenditReturn);

// Provider webhooks. Signature-verified inside the service, so no `authenticate`
// — the signature is the credential.
router.post('/webhook/:provider', handleProviderWebhook);

// Mock payment routes never exist in production: MockProvider accepts any
// signature, so a reachable mock webhook is an open "mark any order paid"
// endpoint. See FLAGS.md.
if (!isProduction) {
  router.post('/mock-webhook', mockWebhook);
}

export default router;
