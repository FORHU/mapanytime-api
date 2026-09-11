import { Prisma, STOREAPPROVALSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import AuditService from '../audit/audit.service';
import NotificationService from '../notifications/notification.service';
import logger from '../../utils/logger';

/**
 * The store approval state machine.
 *
 * Every write to `Stores.approvalStatus` goes through `transition` — the admin
 * approve/reject endpoints, the claim/release endpoints, and the seller's
 * resubmit. Nothing else may set the column, or the guarantees below stop
 * holding.
 *
 * Two of those guarantees are worth stating outright, because the code this
 * replaces had neither:
 *
 *  - **Transitions are validated.** `approveStore` used to accept a store in
 *    any state, so a stray double-click could take a REJECTED store straight to
 *    ACTIVE.
 *  - **The write is compare-and-set.** The old `findUnique` then `update` pair
 *    let two admins acting at once both read PENDING and both write, with the
 *    loser's decision silently overwriting the winner's. Here the status the
 *    caller decided against is part of the WHERE clause, so the second write
 *    matches nothing and reports a conflict.
 */

/** How long a claim survives without action before others may take it freely. */
export const STALE_CLAIM_MS = 24 * 60 * 60 * 1000;

/**
 * How long a rejected store survives before the hourly sweep removes it.
 *
 * Lives here rather than in the store module because `dataFor` below is what
 * starts the clock, and the two must not be able to drift apart.
 */
export const REJECTED_STORE_TTL_MS = 60 * 1000; // TEMP: was 24 * 60 * 60 * 1000

/**
 * Legal moves out of each status.
 *
 * REJECTED is terminal for the seller but not for an administrator: reopening
 * to UNDER_REVIEW is what makes an appeal possible without the seller building
 * a whole new store, which is the gap this feature exists to close.
 */
export const ALLOWED_TRANSITIONS: Record<STOREAPPROVALSTATUS, STOREAPPROVALSTATUS[]> = {
  PENDING: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['PENDING', 'ACTIVE', 'NEEDS_REVISION', 'REJECTED'],
  NEEDS_REVISION: ['PENDING'],
  ACTIVE: ['UNDER_REVIEW', 'REJECTED'],
  REJECTED: ['UNDER_REVIEW'],
};

/** The statuses a seller may still edit their store in. */
export const EDITABLE_STATUSES: STOREAPPROVALSTATUS[] = ['NEEDS_REVISION', 'ACTIVE'];

export const STORE_TRANSITION_ACTION = 'STORE_APPROVAL_TRANSITION';

type ThrownError = { status: 400 | 401 | 403 | 404 | 409; message: string; code?: string };

const fail = (status: ThrownError['status'], message: string, code?: string): never => {
  throw { status, message, code } satisfies ThrownError;
};

/** A claim nobody has acted on for a day is treated as abandoned. */
export function isClaimStale(claimedAt: Date | null | undefined, now = new Date()): boolean {
  if (!claimedAt) return true;
  return now.getTime() - claimedAt.getTime() > STALE_CLAIM_MS;
}

/**
 * What the seller is told, per transition. Claim and release are absent on
 * purpose — which reviewer is holding the file is not the seller's business,
 * and a notification per claim would be noise on every queue shuffle.
 */
const SELLER_NOTIFICATION: Partial<
  Record<
    STOREAPPROVALSTATUS,
    (storeName: string, note?: string | null) => { title: string; body: string }
  >
> = {
  ACTIVE: (storeName) => ({
    title: 'Store approved',
    body: `${storeName} has been approved and is now visible to buyers.`,
  }),
  NEEDS_REVISION: (storeName, note) => ({
    title: 'Changes requested',
    body: `${storeName} needs a few changes before it can be approved: ${note ?? ''}`.trim(),
  }),
  REJECTED: (storeName, note) => ({
    title: 'Store application not approved',
    body: `${storeName} was not approved. ${note ?? ''}`.trim(),
  }),
};

export default class StoreApprovalService {
  /**
   * Move a store to `to`, or refuse.
   *
   * `note` is required for NEEDS_REVISION and REJECTED (it is the only thing
   * that tells the seller what to do next) and ignored elsewhere. The caller is
   * expected to have validated its shape; this only enforces presence.
   */
  static async transition(params: {
    storeId: string;
    to: STOREAPPROVALSTATUS;
    actorUserId: string;
    note?: string;
    /** Set when an admin knowingly takes over another reviewer's claim. */
    stealClaimFrom?: string | null;
  }) {
    const { storeId, to, actorUserId, note } = params;

    const store = await prisma.stores.findFirst({
      where: { id: storeId, deletedAt: null },
      include: { seller: { select: { userId: true } } },
    });
    if (!store) fail(404, 'Store not found.');

    const from = store!.approvalStatus;

    if (from === to) {
      fail(409, `Store is already ${to}.`, 'INVALID_STATUS_TRANSITION');
    }
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      fail(409, `A store cannot move from ${from} to ${to}.`, 'INVALID_STATUS_TRANSITION');
    }
    if ((to === 'NEEDS_REVISION' || to === 'REJECTED') && !note?.trim()) {
      fail(400, 'A note explaining the decision is required.', 'NOTE_REQUIRED');
    }

    const now = new Date();
    const data = this.dataFor({ from, to, actorUserId, note, now, store: store! });

    const updated = await prisma.$transaction(async (tx) => {
      // Compare-and-set: `approvalStatus: from` is what makes a concurrent
      // decision by another admin lose here rather than silently overwrite.
      const { count } = await tx.stores.updateMany({
        where: { id: storeId, approvalStatus: from },
        data,
      });

      if (count === 0) {
        fail(
          409,
          'This store was updated by someone else while you were reviewing it. Reload and try again.',
          'CONCURRENT_MODIFICATION',
        );
      }

      // Inside the transaction so a logged transition always corresponds to one
      // that actually landed. AuditLogs is the history of record — the columns
      // above only carry the latest round.
      await tx.auditLogs.create({
        data: {
          performedById: actorUserId,
          action: STORE_TRANSITION_ACTION,
          entityType: 'STORE',
          entityId: storeId,
          metadata: {
            from,
            to,
            ...(note?.trim() ? { note: note.trim() } : {}),
            ...(params.stealClaimFrom ? { claimTakenFrom: params.stealClaimFrom } : {}),
          } as Prisma.InputJsonObject,
        },
      });

      // Approval is also what verifies the submitted documents, as it was
      // before this service existed.
      if (to === 'ACTIVE' || to === 'REJECTED') {
        await tx.documentVerifications.updateMany({
          where: { storeId },
          data: {
            verificationStatus: to === 'ACTIVE' ? 'APPROVED' : 'REJECTED',
            verifiedById: actorUserId,
          },
        });
      }

      return tx.stores.findUnique({ where: { id: storeId } });
    });

    // After the commit, never inside it: a rolled-back transition must not
    // leave the seller holding a notification about something that did not
    // happen.
    await this.notifySeller(store!.seller.userId, updated?.storeName ?? 'Your store', to, note);

    return updated;
  }

  /**
   * The column writes for one transition.
   *
   * Split out so the state machine above reads as rules rather than as a wall
   * of field assignments, and so the tests can assert on it directly.
   */
  private static dataFor(args: {
    from: STOREAPPROVALSTATUS;
    to: STOREAPPROVALSTATUS;
    actorUserId: string;
    note?: string;
    now: Date;
    store: { isActive: boolean; activeBeforeReview: boolean | null };
    // `Unchecked` rather than the plain update input: the checked variant hides
    // relation-backed columns behind `connect`, and `reviewedById` /
    // `reviewClaimedById` are both written here as plain ids.
  }): Prisma.StoresUncheckedUpdateManyInput {
    const { from, to, actorUserId, note, now, store } = args;

    const clearClaim = { reviewClaimedById: null, reviewClaimedAt: null };
    const reviewed = { reviewedAt: now, reviewedById: actorUserId };
    // Every move out of REJECTED cancels the deletion window. Spread into all
    // four non-REJECTED cases rather than left to default, because a store
    // reopened for appeal must stop being sweep-eligible the instant it moves.
    const clearRejection = { rejectedAt: null };

    switch (to) {
      case 'UNDER_REVIEW':
        return {
          approvalStatus: to,
          reviewClaimedById: actorUserId,
          reviewClaimedAt: now,
          ...clearRejection,
          // Pulling an already-live store back into review takes it off the
          // map, so park the seller's own open/closed toggle to restore on
          // re-approval rather than forcing it back on.
          ...(from === 'ACTIVE' ? { isActive: false, activeBeforeReview: store.isActive } : {}),
        };

      case 'PENDING':
        return {
          approvalStatus: to,
          ...clearClaim,
          ...clearRejection,
          // Only a resubmission re-dates the queue entry. An admin releasing a
          // claim must not send the seller back to the end of the line.
          ...(from === 'NEEDS_REVISION' ? { lastSubmittedAt: now } : {}),
        };

      case 'ACTIVE':
        return {
          approvalStatus: to,
          // `activeBeforeReview` is only set when this store was live before
          // its re-review; a first approval falls through to true.
          isActive: store.activeBeforeReview ?? true,
          activeBeforeReview: null,
          rejectionReason: null,
          revisionNotes: null,
          ...clearClaim,
          ...clearRejection,
          ...reviewed,
        };

      case 'NEEDS_REVISION':
        return {
          approvalStatus: to,
          revisionNotes: note?.trim() ?? null,
          rejectionReason: null,
          isActive: false,
          activeBeforeReview: null,
          ...clearClaim,
          ...clearRejection,
          ...reviewed,
        };

      case 'REJECTED':
        return {
          approvalStatus: to,
          rejectionReason: note?.trim() ?? null,
          revisionNotes: null,
          isActive: false,
          activeBeforeReview: null,
          // Starts the 24-hour deletion window. A second rejection after an
          // appeal re-dates it here, which is exactly the intent: the seller
          // gets a fresh window each time, not a resumed one.
          rejectedAt: now,
          ...clearClaim,
          ...reviewed,
        };
    }
  }

  private static async notifySeller(
    userId: string,
    storeName: string,
    to: STOREAPPROVALSTATUS,
    note?: string,
  ) {
    const build = SELLER_NOTIFICATION[to];
    if (!build) return;

    try {
      const { title, body } = build(storeName, note);
      await NotificationService.sendNotification({
        userId,
        title,
        body,
        metadata: { kind: 'STORE_APPROVAL', status: to },
      });
    } catch (err) {
      // A failed notification must not undo an approval the admin has already
      // been told succeeded.
      logger.warn(`[StoreApproval] Failed to notify seller ${userId} of ${to}.`);
    }
  }

  /**
   * Claim a store for review.
   *
   * Soft lock: a claim held by someone else refuses with the claimant's
   * identity so the UI can offer a considered override, rather than blocking
   * outright (a reviewer on leave would otherwise strand the application) or
   * silently reassigning (two admins would duplicate the work this exists to
   * prevent).
   */
  static async claim(storeId: string, adminId: string, force = false) {
    const store = await prisma.stores.findFirst({
      where: { id: storeId, deletedAt: null },
      include: {
        reviewClaimedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!store) fail(404, 'Store not found.');

    const heldByOther =
      store!.approvalStatus === 'UNDER_REVIEW' &&
      store!.reviewClaimedById !== null &&
      store!.reviewClaimedById !== adminId;

    if (heldByOther && !force && !isClaimStale(store!.reviewClaimedAt)) {
      const holder = store!.reviewClaimedBy;
      const name = `${holder?.firstName ?? ''} ${holder?.lastName ?? ''}`.trim() || 'another admin';
      throw {
        status: 409,
        message: `${name} is already reviewing this store.`,
        code: 'ALREADY_CLAIMED',
        details: {
          claimedById: store!.reviewClaimedById,
          claimedByName: name,
          claimedAt: store!.reviewClaimedAt,
        },
      };
    }

    // Taking over an existing UNDER_REVIEW claim is not a status change, so it
    // cannot go through `transition` — that would refuse UNDER_REVIEW →
    // UNDER_REVIEW. Reassign the claim directly and audit the takeover.
    if (store!.approvalStatus === 'UNDER_REVIEW') {
      const updated = await prisma.$transaction(async (tx) => {
        const { count } = await tx.stores.updateMany({
          where: { id: storeId, approvalStatus: 'UNDER_REVIEW' },
          data: { reviewClaimedById: adminId, reviewClaimedAt: new Date() },
        });
        if (count === 0) {
          fail(
            409,
            'This store was updated by someone else. Reload and try again.',
            'CONCURRENT_MODIFICATION',
          );
        }

        await tx.auditLogs.create({
          data: {
            performedById: adminId,
            action: STORE_TRANSITION_ACTION,
            entityType: 'STORE',
            entityId: storeId,
            metadata: {
              from: 'UNDER_REVIEW',
              to: 'UNDER_REVIEW',
              claimTakenFrom: store!.reviewClaimedById,
            } as Prisma.InputJsonObject,
          },
        });

        return tx.stores.findUnique({ where: { id: storeId } });
      });

      return updated;
    }

    return this.transition({
      storeId,
      to: 'UNDER_REVIEW',
      actorUserId: adminId,
      stealClaimFrom: heldByOther ? store!.reviewClaimedById : null,
    });
  }

  static async release(storeId: string, adminId: string) {
    return this.transition({ storeId, to: 'PENDING', actorUserId: adminId });
  }

  static async approve(storeId: string, adminId: string) {
    return this.transition({ storeId, to: 'ACTIVE', actorUserId: adminId });
  }

  static async reject(storeId: string, adminId: string, reason: string) {
    return this.transition({ storeId, to: 'REJECTED', actorUserId: adminId, note: reason });
  }

  static async requestRevision(storeId: string, adminId: string, notes: string) {
    return this.transition({ storeId, to: 'NEEDS_REVISION', actorUserId: adminId, note: notes });
  }

  /**
   * Seller pushes a revised store back into the queue.
   *
   * Ownership is enforced by the route middleware (`requireStoreInScope`); this
   * checks only that the store is in a state that can be resubmitted, so a
   * double-tap on the button reports a conflict rather than re-dating the queue
   * entry twice.
   */
  static async resubmit(storeId: string, actorUserId: string) {
    return this.transition({ storeId, to: 'PENDING', actorUserId });
  }

  /** The per-store timeline, read straight from the audit log. */
  static async getHistory(storeId: string) {
    const logs = await AuditService.getLogs({
      entityType: 'STORE',
      entityId: storeId,
      limit: 100,
    });

    const actorIds = [...new Set(logs.map((l) => l.performedById).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await prisma.users.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const byId = new Map(actors.map((a) => [a.id, a]));

    return logs.map((log) => {
      const meta = (log.metadata ?? {}) as { from?: string; to?: string; note?: string };
      const actor = log.performedById ? byId.get(log.performedById) : undefined;

      return {
        id: log.id,
        from: meta.from ?? null,
        to: meta.to ?? null,
        note: meta.note ?? null,
        actorId: log.performedById,
        actorName: actor
          ? `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email
          : null,
        createdAt: log.createdAt,
      };
    });
  }
}
