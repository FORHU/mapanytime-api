import express from 'express';
import AgentController from './agent.controller';
import AgentCommissionController from './agent-commission.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAgent } from '../../middleware/agent.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router: express.Router = express.Router();

// Agent-facing routes
router.use(authenticate);

router.get('/recruits', requireAgent, AgentController.getRecruits);
router.post('/register-seller', requireAgent, AgentController.registerSeller);
router.post('/sellers/:sellerId/onboarding', requireAgent, AgentController.onboardSeller);

// Commission & Payouts for agents
router.get('/commission/account', requireAgent, AgentCommissionController.getAccountSummary);
router.get('/commission/transactions', requireAgent, AgentCommissionController.getTransactions);
router.post('/commission/payouts', requireAgent, AgentCommissionController.requestPayout);
router.get('/commission/payouts', requireAgent, AgentCommissionController.getPayouts);
router.get('/commission/config', AgentCommissionController.getConfig);

// Admin-only commission controls
router.patch('/admin/commission/config', requireAdmin, AgentCommissionController.updateConfig);
router.post('/admin/payouts/:id/approve', requireAdmin, AgentCommissionController.approvePayout);

export default router;
