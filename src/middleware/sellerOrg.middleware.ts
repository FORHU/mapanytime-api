import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { resolveOrgContext, OrgContext } from '../modules/organization/orgContext';
import type { SellerFeature } from '../modules/organization/sellerPermissions.constant';

declare module 'express-serve-static-core' {
  interface Request {
    orgContext?: OrgContext;
  }
}

/**
 * Load the requesting user's seller-organization context onto `req.orgContext`.
 *
 * Must run after `authenticate`. Unlike the platform-level guards this never
 * short-circuits on platform role — a user must be a member (or owner) of a
 * seller organization to reach seller-management endpoints.
 */
export const requireSellerOrg = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

    const context = resolveOrgContext(user);
    if (!context.organizationId) {
      return res.status(403).json({
        status: 'error',
        message: 'Forbidden: Not a member of a seller organization',
      });
    }

    req.orgContext = context;
    next();
  } catch {
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during organization verification',
    });
  }
};

/**
 * Gate an organization-managed route on the caller being a `SELLER_ADMIN`.
 * A `SELLER_USER` is refused: managing org stores, members/invites and roles
 * is admin-only.
 */
export const requireSellerOrgAdmin = (req: Request, res: Response, next: NextFunction) => {
  const context = req.orgContext;
  if (!context?.organizationId) {
    return res.status(403).json({
      status: 'error',
      message: 'Forbidden: No seller organization context',
    });
  }
  if (!context.isAdmin) {
    return res.status(403).json({
      status: 'error',
      message: 'Forbidden: Organization admin access required',
    });
  }
  next();
};

/**
 * Gate a route on the caller holding a seller-organization feature permission.
 *
 * Resolves its own context rather than reading `req.orgContext`, so it works on
 * the modules that never mount `requireSellerOrg` — orders, inventory and
 * merchant ads all scope inside their service layer instead. Requiring
 * `requireSellerOrg` here would 403 a pre-organization seller who owns their
 * stores outright, which is exactly the tolerance `storeAccess.ts` exists to
 * preserve.
 *
 * This is a pure in-memory check: `req.user` already carries `orgMemberships`
 * and their `permissions` through `userInclude`, so it costs no query.
 *
 * Note this gates the FEATURE only. Which stores the caller may touch is still
 * decided per-request by `requireStoreInScope` or `assertStoreInScope` — a
 * member holding `products` still reaches only their assigned stores.
 */
export const requireSellerFeature = (code: SellerFeature) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ status: 'error', message: 'Unauthorized' });

    const context = req.orgContext ?? resolveOrgContext(user);

    // A seller with their own `Sellers` row but no organization predates the
    // org model and owns everything they can reach, so they hold every feature.
    const isLegacyOwner = !context.organizationId && Boolean(user.seller);
    if (context.isAdmin || isLegacyOwner) return next();

    if (!context.organizationId) {
      return res.status(403).json({
        status: 'error',
        message: 'Forbidden: Not a member of a seller organization',
      });
    }

    if (!context.permissions.includes(code)) {
      return res.status(403).json({
        status: 'error',
        message: `Forbidden: Missing seller permission [${code}]`,
      });
    }

    next();
  };
};

/**
 * Resolve the `storeId` for a request. Prefers an explicit `:storeId` route
 * param, then a `storeId` in the body or query string.
 */
function extractStoreId(req: Request): string | null {
  const param = req.params.storeId;
  if (param) return param;
  // Store routes use `:id` for the store identifier.
  const idParam = req.params.id;
  if (idParam) return idParam;
  const body = (req.body as { storeId?: string })?.storeId;
  if (body) return body;
  const query = (req.query as { storeId?: string })?.storeId;
  return query ?? null;
}

/**
 * Like `requireStoreInScope` but only when a `storeId` is present on the
 * request. Used on routes where `storeId` is optional (e.g. "all stores" mode).
 */
export const requireStoreInScopeIfPresent = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!extractStoreId(req)) return next();
  return requireStoreInScope(req, res, next);
};

/**
 * Verify the target store belongs to the requesting user's organization and,
 * for non-admin members, is within their explicitly assigned stores. Returns
 * 404 (not 403) so a caller cannot probe which store ids exist elsewhere.
 */
export const requireStoreInScope = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = req.orgContext;
    const storeId = extractStoreId(req);
    if (!context?.organizationId || !storeId) {
      return res.status(400).json({ status: 'error', message: 'storeId is required' });
    }

    const store = await prisma.stores.findUnique({ where: { id: storeId } });
    if (!store || store.sellerOrganizationId !== context.organizationId) {
      return res.status(404).json({ status: 'error', message: 'Store not found.' });
    }

    if (!context.isAdmin && context.assignedStoreIds) {
      if (!context.assignedStoreIds.includes(storeId)) {
        return res.status(404).json({ status: 'error', message: 'Store not found.' });
      }
    }

    next();
  } catch {
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during store scope verification',
    });
  }
};
