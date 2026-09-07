import OrganizationService from '../../src/modules/organization/organization.service';
import OrganizationRepository from '../../src/modules/organization/organization.repository';
import { SYSTEM_ROLES } from '../../src/constants/roles.constant';
import { PERMISSIONS } from '../../src/constants/permissions.constant';

/**
 * Staff management authorization for a seller organization.
 *
 * The reported hole: a SELLER_ADMIN the owner had hired could remove the owner
 * from the organization. `deleteMember` only refused *self* removal, and the
 * owner's membership row — provisioned by `ensureSellerOrganization` — looked
 * like any other SELLER_ADMIN to every guard on the route.
 *
 * `updateMember` had the same gap and a worse consequence: demoting the owner to
 * SELLER_MEMBER leaves them holding a membership that says "not an admin", and
 * `resolveOrgContext` only falls back to the `Sellers` row when no membership
 * exists at all — so the owner loses control of the organization they registered
 * and the staff admin is the only admin left.
 *
 * Everything here exercises the service directly, which is where the checks
 * live. The route's `requireSellerOrgAdmin` is a separate gate covered in
 * sellerOrg.middleware.test.ts; these cases assume it has already passed, which
 * is exactly the attacker's position — a real SELLER_ADMIN calling the API
 * directly rather than through the team page.
 */

jest.mock('../../src/modules/organization/organization.repository', () => {
  const actual = jest.requireActual('../../src/modules/organization/organization.repository');
  return {
    __esModule: true,
    // Keep the real serializer: the success paths assert on its output.
    ...actual,
    default: {
      getMembers: jest.fn(),
      getMemberById: jest.fn(),
      getOwnerUserId: jest.fn(),
      getOrgStores: jest.fn(),
      updateMember: jest.fn(),
      deleteMember: jest.fn(),
    },
  };
});
jest.mock('../../src/modules/auth/auth.service', () => ({
  __esModule: true,
  default: { storeResetCode: jest.fn() },
}));
jest.mock('../../src/infrastructure/rabbitmq/publisher', () => ({ publish: jest.fn() }));
jest.mock('../../src/utils/prisma', () => ({ prisma: { $transaction: jest.fn() } }));

const mockedRepo = OrganizationRepository as unknown as {
  getMembers: jest.Mock;
  getMemberById: jest.Mock;
  getOwnerUserId: jest.Mock;
  getOrgStores: jest.Mock;
  updateMember: jest.Mock;
  deleteMember: jest.Mock;
};

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const OWNER_USER = 'user-owner';
const STAFF_ADMIN_USER = 'user-staff-admin';

/** The owner's own membership row — a SELLER_ADMIN like any hired admin. */
const ownerMember = {
  id: 'member-owner',
  sellerId: ORG,
  userId: OWNER_USER,
  role: SYSTEM_ROLES.SELLER_ADMIN,
  permissions: [] as string[],
  assignedStoreIds: [] as string[],
  user: { id: OWNER_USER, email: 'owner@example.com', firstName: 'Ana', lastName: 'Cruz' },
};

const staffMember = {
  id: 'member-staff',
  sellerId: ORG,
  userId: 'user-staff',
  role: SYSTEM_ROLES.SELLER_MEMBER,
  permissions: [PERMISSIONS.ORDERS_PROCESS, PERMISSIONS.PRODUCTS_VIEW],
  assignedStoreIds: ['store-1'],
  user: { id: 'user-staff', email: 'staff@example.com', firstName: 'Rico', lastName: 'Bautista' },
};

/** A row that exists, but in someone else's organization. */
const foreignMember = {
  ...staffMember,
  id: 'member-foreign',
  sellerId: OTHER_ORG,
  userId: 'user-foreign',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.getOwnerUserId.mockResolvedValue(OWNER_USER);
  mockedRepo.getOrgStores.mockResolvedValue([{ id: 'store-1' }]);
  mockedRepo.deleteMember.mockResolvedValue(undefined);
  mockedRepo.updateMember.mockImplementation((id: string, data: Record<string, unknown>) =>
    Promise.resolve({ ...staffMember, id, ...data }),
  );
});

describe('owner protection', () => {
  it('refuses to remove the organization owner', async () => {
    // The reported vulnerability, from the attacker's position: a hired
    // SELLER_ADMIN calling DELETE /members/:id with the owner's member id.
    mockedRepo.getMemberById.mockResolvedValue(ownerMember);

    await expect(
      OrganizationService.deleteMember(ORG, ownerMember.id, STAFF_ADMIN_USER),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('owner cannot be removed'),
    });

    expect(mockedRepo.deleteMember).not.toHaveBeenCalled();
  });

  it('refuses to demote the organization owner', async () => {
    // Sharper than deletion: a demoted owner keeps a membership row, so
    // resolveOrgContext never falls back to their Sellers row and they lose
    // admin on the organization they registered.
    mockedRepo.getMemberById.mockResolvedValue(ownerMember);

    await expect(
      OrganizationService.updateMember(ORG, ownerMember.id, SYSTEM_ROLES.SELLER_MEMBER),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("owner's role and permissions cannot be changed"),
    });

    expect(mockedRepo.updateMember).not.toHaveBeenCalled();
  });

  it("refuses to strip the owner's permissions without touching their role", async () => {
    mockedRepo.getMemberById.mockResolvedValue(ownerMember);

    await expect(
      OrganizationService.updateMember(ORG, ownerMember.id, undefined, undefined, []),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockedRepo.updateMember).not.toHaveBeenCalled();
  });

  it('holds even when the owner is the caller, so they cannot lock themselves out', async () => {
    // Self-demotion is the same lockout by another route, and no flow needs it.
    mockedRepo.getMemberById.mockResolvedValue(ownerMember);

    await expect(
      OrganizationService.updateMember(ORG, ownerMember.id, SYSTEM_ROLES.SELLER_MEMBER),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('marks the owner row in the member list so the UI can drop the actions', async () => {
    mockedRepo.getMembers.mockResolvedValue([ownerMember, staffMember]);

    const members = await OrganizationService.listMembers(ORG);

    expect(members.map((m) => [m.userId, m.isOwner])).toEqual([
      [OWNER_USER, true],
      ['user-staff', false],
    ]);
  });
});

describe('the owner managing staff normally', () => {
  it('lets the owner remove a staff member', async () => {
    mockedRepo.getMemberById.mockResolvedValue(staffMember);

    await expect(
      OrganizationService.deleteMember(ORG, staffMember.id, OWNER_USER),
    ).resolves.toEqual({ memberId: staffMember.id });

    expect(mockedRepo.deleteMember).toHaveBeenCalledWith(staffMember.id);
  });

  it('lets a hired admin remove a different staff member', async () => {
    // Owner protection is not "only the owner may manage staff" — the existing
    // admin-manages-staff model is untouched.
    mockedRepo.getMemberById.mockResolvedValue(staffMember);

    await expect(
      OrganizationService.deleteMember(ORG, staffMember.id, STAFF_ADMIN_USER),
    ).resolves.toEqual({ memberId: staffMember.id });

    expect(mockedRepo.deleteMember).toHaveBeenCalledWith(staffMember.id);
  });

  it('still refuses self-removal for a non-owner admin', async () => {
    const selfRow = { ...staffMember, userId: STAFF_ADMIN_USER };
    mockedRepo.getMemberById.mockResolvedValue(selfRow);

    await expect(
      OrganizationService.deleteMember(ORG, selfRow.id, STAFF_ADMIN_USER),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockedRepo.deleteMember).not.toHaveBeenCalled();
  });
});

describe('cross-organization access', () => {
  it('answers 404 when deleting a member of another organization', async () => {
    // 404 rather than 403 so a member id cannot be probed for existence.
    mockedRepo.getMemberById.mockResolvedValue(foreignMember);

    await expect(
      OrganizationService.deleteMember(ORG, foreignMember.id, STAFF_ADMIN_USER),
    ).rejects.toMatchObject({ status: 404, message: 'Member not found' });

    expect(mockedRepo.deleteMember).not.toHaveBeenCalled();
  });

  it('answers 404 when updating a member of another organization', async () => {
    mockedRepo.getMemberById.mockResolvedValue(foreignMember);

    await expect(
      OrganizationService.updateMember(ORG, foreignMember.id, SYSTEM_ROLES.SELLER_ADMIN),
    ).rejects.toMatchObject({ status: 404 });

    expect(mockedRepo.updateMember).not.toHaveBeenCalled();
  });

  it('checks organization membership before owner status, so no owner is leaked', async () => {
    // The foreign row must be rejected on tenancy alone — reaching the owner
    // lookup would mean the org check depends on data from another tenant.
    mockedRepo.getMemberById.mockResolvedValue(foreignMember);

    await expect(
      OrganizationService.deleteMember(ORG, foreignMember.id, STAFF_ADMIN_USER),
    ).rejects.toMatchObject({ status: 404 });

    expect(mockedRepo.getOwnerUserId).not.toHaveBeenCalled();
  });

  it('answers 404 for a member id that does not exist at all', async () => {
    mockedRepo.getMemberById.mockResolvedValue(null);

    await expect(
      OrganizationService.deleteMember(ORG, 'no-such-member', STAFF_ADMIN_USER),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('role permissions', () => {
  it('swaps in the manager defaults when a member is promoted', async () => {
    mockedRepo.getMemberById.mockResolvedValue(staffMember);

    await OrganizationService.updateMember(ORG, staffMember.id, SYSTEM_ROLES.SELLER_MANAGER);

    expect(mockedRepo.updateMember).toHaveBeenCalledWith(staffMember.id, {
      role: SYSTEM_ROLES.SELLER_MANAGER,
      permissions: [
        PERMISSIONS.ORDERS_PROCESS,
        PERMISSIONS.PRODUCTS_VIEW,
        PERMISSIONS.PRODUCTS_EDIT,
        PERMISSIONS.PROMOTIONS_ADD,
      ],
    });
  });

  it('clears stores and stored permissions when a member is promoted to admin', async () => {
    // An admin holds every feature implicitly and sees every store, so storing
    // either for them would go stale the moment a feature is added.
    mockedRepo.getMemberById.mockResolvedValue(staffMember);

    await OrganizationService.updateMember(ORG, staffMember.id, SYSTEM_ROLES.SELLER_ADMIN);

    expect(mockedRepo.updateMember).toHaveBeenCalledWith(staffMember.id, {
      role: SYSTEM_ROLES.SELLER_ADMIN,
      storeIds: [],
      permissions: [],
    });
  });

  it('honours an explicit empty permission list as "no features"', async () => {
    mockedRepo.getMemberById.mockResolvedValue(staffMember);

    await OrganizationService.updateMember(ORG, staffMember.id, undefined, undefined, []);

    expect(mockedRepo.updateMember).toHaveBeenCalledWith(staffMember.id, { permissions: [] });
  });

  it('rejects a permission code outside the seller catalogue', async () => {
    // Direct-API defence: the Joi schema only checks that the entries are
    // strings, so an unknown code has to fail here.
    mockedRepo.getMemberById.mockResolvedValue(staffMember);

    await expect(
      OrganizationService.updateMember(ORG, staffMember.id, undefined, undefined, ['users.delete']),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockedRepo.updateMember).not.toHaveBeenCalled();
  });

  it('refuses store assignments that belong to another organization', async () => {
    mockedRepo.getMemberById.mockResolvedValue(staffMember);
    mockedRepo.getOrgStores.mockResolvedValue([]);

    await expect(
      OrganizationService.updateMember(ORG, staffMember.id, undefined, ['store-elsewhere']),
    ).rejects.toMatchObject({ status: 404 });

    expect(mockedRepo.updateMember).not.toHaveBeenCalled();
  });
});
