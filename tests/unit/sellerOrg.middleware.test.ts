import type { Request, Response, NextFunction } from 'express';
import {
  requireSellerFeature,
  requireSellerOrgAdmin,
} from '../../src/middleware/sellerOrg.middleware';
import type { OrgContext } from '../../src/modules/organization/orgContext';
import { ALL_SELLER_FEATURES } from '../../src/modules/organization/sellerPermissions.constant';

jest.mock('../../src/utils/prisma', () => ({ prisma: { stores: { findUnique: jest.fn() } } }));

function makeRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: { message?: string } };
}

const ADMIN: OrgContext = {
  organizationId: 'org-1',
  role: 'SELLER_ADMIN',
  isAdmin: true,
  assignedStoreIds: null,
  permissions: [...ALL_SELLER_FEATURES],
};

const MEMBER: OrgContext = {
  organizationId: 'org-1',
  role: 'SELLER_USER',
  isAdmin: false,
  assignedStoreIds: ['store-1'],
  permissions: ['orders', 'products'],
};

/**
 * `requireSellerOrgAdmin` replaced six permission codes across eleven routes —
 * store create/update and every member/invite endpoint — when org roles became
 * a fixed enum. It had no test, so the only evidence a SELLER_USER could not
 * create a store or add members was reading the route files.
 */
describe('requireSellerOrgAdmin', () => {
  it('admits a SELLER_ADMIN', () => {
    const req = { orgContext: ADMIN } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    requireSellerOrgAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('refuses a SELLER_USER with 403', () => {
    const req = { orgContext: MEMBER } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    requireSellerOrgAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/admin/i);
  });

  it('refuses a caller with no organization context at all', () => {
    // Fails closed: missing context must never be read as "allowed".
    const req = {} as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    requireSellerOrgAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('refuses a context whose organizationId is null even if isAdmin is true', () => {
    // Guards the fallback shape: isAdmin without an org must not pass.
    const req = {
      orgContext: { organizationId: null, role: null, isAdmin: true, assignedStoreIds: null },
    } as unknown as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    requireSellerOrgAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

/**
 * The feature gate resolves its own context rather than reading `req.orgContext`,
 * because orders, inventory and merchant ads never mount `requireSellerOrg`.
 * These cases pin both paths: a pre-resolved context, and a bare `req.user`.
 */
describe('requireSellerFeature', () => {
  const run = (req: Partial<Request>, code: 'orders' | 'promotions' = 'promotions') => {
    const res = makeRes();
    const next = jest.fn() as NextFunction;
    requireSellerFeature(code)(req as Request, res, next);
    return { res, next };
  };

  it('admits an org admin regardless of their stored list', () => {
    const { res, next } = run({ orgContext: ADMIN, user: { id: 'u1' } } as unknown as Request);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('admits a member holding the code', () => {
    const { res, next } = run(
      { orgContext: MEMBER, user: { id: 'u1' } } as unknown as Request,
      'orders',
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('refuses a member without the code, naming it', () => {
    const { res, next } = run({ orgContext: MEMBER, user: { id: 'u1' } } as unknown as Request);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/promotions/);
  });

  it('treats an emptied list as no access, not as "fall back to the role default"', () => {
    // The whole reason defaults are resolved at write time: an admin who
    // unticks every box must actually be able to revoke access.
    const stripped: OrgContext = { ...MEMBER, permissions: [] };
    const { res, next } = run(
      { orgContext: stripped, user: { id: 'u1' } } as unknown as Request,
      'orders',
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('resolves context from req.user when no middleware populated it', () => {
    // The orders/inventory/merchantAds path — no requireSellerOrg upstream.
    const req = {
      user: {
        id: 'u1',
        orgMemberships: [
          {
            sellerOrganizationId: 'org-1',
            role: 'SELLER_USER',
            assignedStores: [{ storeId: 'store-1' }],
            permissions: ['orders'],
          },
        ],
      },
    } as unknown as Request;

    expect(run(req, 'orders').next).toHaveBeenCalledTimes(1);
    expect(run(req, 'promotions').res.statusCode).toBe(403);
  });

  it('admits a pre-organization seller who has a Sellers row but no membership', () => {
    // Refusing them would reverse the tolerance storeAccess.ts preserves.
    const req = {
      user: { id: 'u1', orgMemberships: [], seller: { id: 'seller-1' } },
    } as unknown as Request;

    const { res, next } = run(req);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('refuses a caller with neither a membership nor a Sellers row', () => {
    const req = { user: { id: 'u1', orgMemberships: [] } } as unknown as Request;

    const { res, next } = run(req);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('401s when there is no authenticated user', () => {
    const { res, next } = run({} as Request);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
