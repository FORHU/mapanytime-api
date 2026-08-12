import { Router } from 'express';
import AnalyticsController from './analytics.controller';
import { optionalAuthenticate } from '../../middleware/auth.middleware';

const router = Router();

// Ingestion is deliberately open to anonymous callers — most marketplace
// browsing happens before anyone signs in, and excluding it would bias every
// ranking built on this data toward logged-in users. optionalAuthenticate
// attributes the event when a token is present and lets it through when not.
router.post('/events', optionalAuthenticate, AnalyticsController.record);

export default router;
