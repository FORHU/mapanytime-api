import StoreApprovalService, {
  ALLOWED_TRANSITIONS,
  STALE_CLAIM_MS,
  isClaimStale,
} from '../../src/modules/adminApprovals/storeApproval.service';
import { prisma } from '../../src/utils/prisma';
import NotificationService from '../../src/modules/notifications/notification.service';
import type { STOREAPPROVALSTATUS } from '@prisma/client';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    stores: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    auditLogs: { create: jest.fn() },
    documentVerifications: { updateMany: jest.fn() },
    users: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../src/modules/notifications/notification.service', () => ({
  __esModule: true,
  default: { sendNotification: jest.fn() },
}));

const ALL_STATUSES: STOREAPPROVALSTATUS[] = [
  'PENDING',
  'UNDER_REVIEW',
  'NEEDS_REVISION',
  'ACTIVE',
  'REJECTED',
];

/** The store row `transition` reads before deciding anything. */
function mockStore(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'store-1',
    storeName: 'Test Store',
    approvalStatus: 'PENDING' as STOREAPPROVALSTATUS,
    isActive: false,
    activeBeforeReview: null,
    reviewClaimedById: null,
    reviewClaimedAt: null,
    deletedAt: null,
    seller: { userId: 'user-seller' },
    ...overrides,
  };
}

/** The transaction body runs against these; `data` is what we assert on. */
const tx = {
  stores: { updateMany: jest.fn(), findUnique: jest.fn() },
  auditLogs: { create: jest.fn() },
  documentVerifications: { updateMany: jest.fn() },
};

/** The `data` object handed to the compare-and-set write. */
const writtenData = () => tx.stores.updateMany.mock.calls[0][0].data;
/** The `where` clause — the compare half of compare-and-set. */
const writtenWhere = () => tx.stores.updateMany.mock.calls[0][0].where;

beforeEach(() => {
  jest.clearAllMocks();

  tx.stores.updateMany.mockResolvedValue({ count: 1 });
  tx.stores.findUnique.mockResolvedValue({ id: 'store-1', storeName: 'Test Store' });
  tx.auditLogs.create.mockResolvedValue({});
  tx.documentVerifications.updateMany.mockResolvedValue({ count: 0 });

  (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));
  (NotificationService.sendNotification as jest.Mock).mockResolvedValue({});
});

describe('the transition matrix', () => {
  it.each([
    ['PENDING', 'UNDER_REVIEW'],
    ['UNDER_REVIEW', 'ACTIVE'],
    ['UNDER_REVIEW', 'NEEDS_REVISION'],
    ['UNDER_REVIEW', 'REJECTED'],
    ['UNDER_REVIEW', 'PENDING'],
    ['NEEDS_REVISION', 'PENDING'],
    ['ACTIVE', 'UNDER_REVIEW'],
    ['ACTIVE', 'REJECTED'],
    ['REJECTED', 'UNDER_REVIEW'],
  ] as [STOREAPPROVALSTATUS, STOREAPPROVALSTATUS][])('allows %s → %s', async (from, to) => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(mockStore({ approvalStatus: from }));

    await StoreApprovalService.transition({
      storeId: 'store-1',
      to,
      actorUserId: 'admin-1',
      note: 'Please attach a clearer permit scan.',
    });

    expect(writtenData()).toMatchObject({ approvalStatus: to });
  });

  /**
   * The complement of the table above. Generated rather than listed so a future
   * edit to ALLOWED_TRANSITIONS cannot quietly widen the machine without a test
   * noticing — a hand-written list of refusals would keep passing.
   */
  it.each(
    ALL_STATUSES.flatMap((from) =>
      ALL_STATUSES.filter((to) => from !== to && !ALLOWED_TRANSITIONS[from].includes(to)).map(
        (to) => [from, to] as [STOREAPPROVALSTATUS, STOREAPPROVALSTATUS],
      ),
    ),
  )('refuses %s → %s with 409', async (from, to) => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(mockStore({ approvalStatus: from }));

    await expect(
      StoreApprovalService.transition({
        storeId: 'store-1',
        to,
        actorUserId: 'admin-1',
        note: 'a note',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });

    expect(tx.stores.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a no-op transition rather than re-dating the record', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'ACTIVE' }),
    );

    await expect(
      StoreApprovalService.transition({ storeId: 'store-1', to: 'ACTIVE', actorUserId: 'admin-1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('404s on a store that does not exist', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      StoreApprovalService.transition({ storeId: 'nope', to: 'UNDER_REVIEW', actorUserId: 'a' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('concurrency', () => {
  it('scopes the write to the status the admin decided against', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'UNDER_REVIEW' }),
    );

    await StoreApprovalService.approve('store-1', 'admin-1');

    // This is the whole compare-and-set: without `approvalStatus` in the WHERE,
    // a second admin's decision would overwrite the first silently.
    expect(writtenWhere()).toEqual({ id: 'store-1', approvalStatus: 'UNDER_REVIEW' });
  });

  it('reports a conflict when another admin got there first', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'UNDER_REVIEW' }),
    );
    tx.stores.updateMany.mockResolvedValue({ count: 0 });

    await expect(StoreApprovalService.approve('store-1', 'admin-2')).rejects.toMatchObject({
      status: 409,
      code: 'CONCURRENT_MODIFICATION',
    });
  });
});

describe('what each decision writes', () => {
  const from = (status: STOREAPPROVALSTATUS, extra = {}) =>
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: status, ...extra }),
    );

  it('records the claimant on claim', async () => {
    from('PENDING');
    await StoreApprovalService.claim('store-1', 'admin-1');

    expect(writtenData()).toMatchObject({
      approvalStatus: 'UNDER_REVIEW',
      reviewClaimedById: 'admin-1',
    });
  });

  it('clears the claim on every exit from review', async () => {
    from('UNDER_REVIEW');
    await StoreApprovalService.approve('store-1', 'admin-1');

    expect(writtenData()).toMatchObject({ reviewClaimedById: null, reviewClaimedAt: null });
  });

  it('stores the revision note where the seller reads it, not as a rejection', async () => {
    from('UNDER_REVIEW');
    await StoreApprovalService.requestRevision(
      'store-1',
      'admin-1',
      '  Permit scan is unreadable  ',
    );

    expect(writtenData()).toMatchObject({
      approvalStatus: 'NEEDS_REVISION',
      revisionNotes: 'Permit scan is unreadable',
      rejectionReason: null,
    });
  });

  it('requires a note before sending a store back', async () => {
    from('UNDER_REVIEW');

    await expect(
      StoreApprovalService.requestRevision('store-1', 'admin-1', '   '),
    ).rejects.toMatchObject({ status: 400, code: 'NOTE_REQUIRED' });
  });

  it('requires a reason before rejecting', async () => {
    from('UNDER_REVIEW');

    await expect(StoreApprovalService.reject('store-1', 'admin-1', '')).rejects.toMatchObject({
      status: 400,
      code: 'NOTE_REQUIRED',
    });
  });

  it('clears both notes on approval so a stale fix list cannot linger', async () => {
    from('UNDER_REVIEW');
    await StoreApprovalService.approve('store-1', 'admin-1');

    expect(writtenData()).toMatchObject({ revisionNotes: null, rejectionReason: null });
  });

  /**
   * The clock behind the 24-hour deletion window. `rejectedAt` is written here
   * and nowhere else, so these are the cases that decide whether a store is ever
   * swept — including the two edge cases the feature turns on: an appeal must
   * cancel the timer, and a second rejection must start a fresh one.
   */
  describe('the rejection clock', () => {
    it('starts the deletion window on rejection', async () => {
      from('UNDER_REVIEW');
      await StoreApprovalService.reject('store-1', 'admin-1', 'Permit is not valid');

      expect(writtenData()).toMatchObject({
        approvalStatus: 'REJECTED',
        rejectedAt: expect.any(Date),
      });
    });

    it('cancels the window when an admin reopens the store for appeal', async () => {
      from('REJECTED');
      await StoreApprovalService.claim('store-1', 'admin-1');

      expect(writtenData()).toMatchObject({
        approvalStatus: 'UNDER_REVIEW',
        rejectedAt: null,
      });
    });

    // Not a resumed window: a store rejected a second time gets the full 24
    // hours again, dated from the new decision.
    it('re-dates the window when a reopened store is rejected again', async () => {
      const first = new Date('2026-09-08T10:00:00.000Z');
      jest.useFakeTimers().setSystemTime(first);
      from('UNDER_REVIEW');
      await StoreApprovalService.reject('store-1', 'admin-1', 'Still not valid');
      const firstRejectedAt = (writtenData() as { rejectedAt: Date }).rejectedAt;

      jest.clearAllMocks();
      tx.stores.updateMany.mockResolvedValue({ count: 1 });
      tx.stores.findUnique.mockResolvedValue({ storeName: 'Test Store' });
      (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));

      jest.setSystemTime(new Date('2026-09-09T10:00:00.000Z'));
      from('UNDER_REVIEW');
      await StoreApprovalService.reject('store-1', 'admin-1', 'Rejected again');
      const secondRejectedAt = (writtenData() as { rejectedAt: Date }).rejectedAt;

      expect(secondRejectedAt.getTime()).toBeGreaterThan(firstRejectedAt.getTime());
      jest.useRealTimers();
    });

    it.each(['ACTIVE', 'NEEDS_REVISION'] as const)(
      'clears the window on a move to %s',
      async (to) => {
        from('UNDER_REVIEW');
        if (to === 'ACTIVE') {
          await StoreApprovalService.approve('store-1', 'admin-1');
        } else {
          await StoreApprovalService.requestRevision('store-1', 'admin-1', 'Fix the permit');
        }

        expect(writtenData()).toMatchObject({ approvalStatus: to, rejectedAt: null });
      },
    );

    it('clears the window on a release back to the queue', async () => {
      from('UNDER_REVIEW');
      await StoreApprovalService.release('store-1', 'admin-1');

      expect(writtenData()).toMatchObject({ approvalStatus: 'PENDING', rejectedAt: null });
    });
  });

  it('re-dates the queue entry on resubmission but not on a claim release', async () => {
    from('NEEDS_REVISION');
    await StoreApprovalService.resubmit('store-1', 'user-seller');
    expect(writtenData()).toHaveProperty('lastSubmittedAt');

    jest.clearAllMocks();
    tx.stores.updateMany.mockResolvedValue({ count: 1 });
    tx.stores.findUnique.mockResolvedValue({ storeName: 'Test Store' });
    (prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx));

    from('UNDER_REVIEW');
    await StoreApprovalService.release('store-1', 'admin-1');
    // Releasing a claim is the admin's bookkeeping; it must not send the seller
    // to the back of the queue.
    expect(writtenData()).not.toHaveProperty('lastSubmittedAt');
  });
});

/**
 * The map filters on `isActive` alone, so a re-review has to take a live store
 * off it — which means the seller's own open/closed toggle has to be parked
 * somewhere and put back, or re-approval silently reopens a store they closed.
 */
describe('the seller open/closed toggle across a re-review', () => {
  it('parks the toggle when pulling a live store back into review', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'ACTIVE', isActive: false }),
    );

    await StoreApprovalService.claim('store-1', 'admin-1');

    expect(writtenData()).toMatchObject({ isActive: false, activeBeforeReview: false });
  });

  it('does not reopen a store the seller had closed', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'UNDER_REVIEW', isActive: false, activeBeforeReview: false }),
    );

    await StoreApprovalService.approve('store-1', 'admin-1');

    expect(writtenData()).toMatchObject({ isActive: false, activeBeforeReview: null });
  });

  it('still opens a store on its first approval', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'UNDER_REVIEW', isActive: false, activeBeforeReview: null }),
    );

    await StoreApprovalService.approve('store-1', 'admin-1');

    expect(writtenData()).toMatchObject({ isActive: true });
  });
});

describe('audit trail', () => {
  it('records from, to and the note in the same transaction as the write', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'UNDER_REVIEW' }),
    );

    await StoreApprovalService.requestRevision('store-1', 'admin-1', 'Fix the address');

    expect(tx.auditLogs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        performedById: 'admin-1',
        entityType: 'STORE',
        entityId: 'store-1',
        metadata: expect.objectContaining({
          from: 'UNDER_REVIEW',
          to: 'NEEDS_REVISION',
          note: 'Fix the address',
        }),
      }),
    });
  });

  it('writes no audit row when the transition is refused', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'PENDING' }),
    );

    await expect(StoreApprovalService.approve('store-1', 'admin-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.auditLogs.create).not.toHaveBeenCalled();
  });
});

describe('claiming', () => {
  it('refuses a store another admin is holding, and says who', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({
        approvalStatus: 'UNDER_REVIEW',
        reviewClaimedById: 'admin-other',
        reviewClaimedAt: new Date(),
        reviewClaimedBy: { id: 'admin-other', firstName: 'Dana', lastName: 'Cruz' },
      }),
    );

    await expect(StoreApprovalService.claim('store-1', 'admin-1')).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_CLAIMED',
      details: expect.objectContaining({ claimedByName: 'Dana Cruz' }),
    });
  });

  it('lets an admin take over deliberately', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({
        approvalStatus: 'UNDER_REVIEW',
        reviewClaimedById: 'admin-other',
        reviewClaimedAt: new Date(),
        reviewClaimedBy: { id: 'admin-other', firstName: 'Dana', lastName: 'Cruz' },
      }),
    );

    await StoreApprovalService.claim('store-1', 'admin-1', true);

    expect(writtenData()).toMatchObject({ reviewClaimedById: 'admin-1' });
    expect(tx.auditLogs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ claimTakenFrom: 'admin-other' }),
      }),
    });
  });

  it('treats an abandoned claim as free without needing force', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({
        approvalStatus: 'UNDER_REVIEW',
        reviewClaimedById: 'admin-other',
        reviewClaimedAt: new Date(Date.now() - STALE_CLAIM_MS - 1000),
        reviewClaimedBy: { id: 'admin-other', firstName: 'Dana', lastName: 'Cruz' },
      }),
    );

    await StoreApprovalService.claim('store-1', 'admin-1');

    expect(writtenData()).toMatchObject({ reviewClaimedById: 'admin-1' });
  });

  it('reclaiming your own store is not a conflict', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({
        approvalStatus: 'UNDER_REVIEW',
        reviewClaimedById: 'admin-1',
        reviewClaimedAt: new Date(),
        reviewClaimedBy: { id: 'admin-1', firstName: 'Same', lastName: 'Admin' },
      }),
    );

    await expect(StoreApprovalService.claim('store-1', 'admin-1')).resolves.toBeDefined();
  });
});

describe('isClaimStale', () => {
  it('treats an unset claim as free', () => {
    expect(isClaimStale(null)).toBe(true);
  });

  it('holds a fresh claim', () => {
    expect(isClaimStale(new Date())).toBe(false);
  });

  it('releases one nobody has acted on', () => {
    expect(isClaimStale(new Date(Date.now() - STALE_CLAIM_MS - 1))).toBe(true);
  });
});

describe('seller notifications', () => {
  it.each([
    ['ACTIVE', 'UNDER_REVIEW'],
    ['NEEDS_REVISION', 'UNDER_REVIEW'],
    ['REJECTED', 'UNDER_REVIEW'],
  ] as [STOREAPPROVALSTATUS, STOREAPPROVALSTATUS][])(
    'tells the seller about %s',
    async (to, from) => {
      (prisma.stores.findFirst as jest.Mock).mockResolvedValue(mockStore({ approvalStatus: from }));

      await StoreApprovalService.transition({
        storeId: 'store-1',
        to,
        actorUserId: 'admin-1',
        note: 'Because of the permit.',
      });

      expect(NotificationService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-seller' }),
      );
    },
  );

  it('stays quiet about reviewer bookkeeping', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'PENDING' }),
    );

    await StoreApprovalService.claim('store-1', 'admin-1');

    expect(NotificationService.sendNotification).not.toHaveBeenCalled();
  });

  it('does not fail an approval because the notification failed', async () => {
    (prisma.stores.findFirst as jest.Mock).mockResolvedValue(
      mockStore({ approvalStatus: 'UNDER_REVIEW' }),
    );
    (NotificationService.sendNotification as jest.Mock).mockRejectedValue(new Error('socket down'));

    await expect(StoreApprovalService.approve('store-1', 'admin-1')).resolves.toBeDefined();
  });
});
