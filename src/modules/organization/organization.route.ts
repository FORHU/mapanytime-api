import { Router } from 'express';
import OrganizationController from './organization.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireSellerOrg, requireSellerOrgAdmin } from '../../middleware/sellerOrg.middleware';

const router = Router();

// Org context + scoped store list — available to any org member.
router.get('/context', authenticate, requireSellerOrg, OrganizationController.getContext);
router.get('/stores', authenticate, requireSellerOrg, OrganizationController.getStores);

// Member management — seller_admin only.
router.get(
  '/members',
  authenticate,
  requireSellerOrg,
  requireSellerOrgAdmin,
  OrganizationController.listMembers,
);
// Registered before '/members' so the literal path is not swallowed as a body
// route by the generic member handler.
router.post(
  '/members/create',
  authenticate,
  requireSellerOrg,
  requireSellerOrgAdmin,
  OrganizationController.createStaffAccount,
);
// Attaches a user who already has an account; '/members/create' makes a new one.
router.post(
  '/members',
  authenticate,
  requireSellerOrg,
  requireSellerOrgAdmin,
  OrganizationController.createMember,
);
router.patch(
  '/members/:id',
  authenticate,
  requireSellerOrg,
  requireSellerOrgAdmin,
  OrganizationController.updateMember,
);
router.delete(
  '/members/:id',
  authenticate,
  requireSellerOrg,
  requireSellerOrgAdmin,
  OrganizationController.deleteMember,
);

// Invites were removed: an admin now creates the staff account outright via
// POST /members/create, which assigns stores in the same transaction. The old
// flow could not express a store assignment, so an accepted invite produced a
// member who could see nothing.

export default router;
