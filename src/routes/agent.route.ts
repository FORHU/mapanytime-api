import express from 'express';
import AgentController from '../controllers/agent.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAgent } from '../middleware/agent.middleware';

const router: express.Router = express.Router();

router.use(authenticate, requireAgent);
router.post('/register-seller', AgentController.registerSeller);
router.post('/sellers/:sellerId/onboarding', AgentController.onboardSeller);

export default router;
