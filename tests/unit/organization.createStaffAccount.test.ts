import OrganizationService from '../../src/modules/organization/organization.service';
import OrganizationRepository from '../../src/modules/organization/organization.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/organization/organization.repository');
jest.mock('../../src/modules/auth/auth.service', () => ({
  __esModule: true,
  default: { storeResetCode: jest.fn() },
}));
jest.mock('../../src/infrastructure/rabbitmq/publisher', () => ({ publish: jest.fn() }));
jest.mock('../../src/utils/prisma', () => ({ prisma: { $transaction: jest.fn() } }));

const mockedRepo = OrganizationRepository as unknown as {
  findUserByEmail: jest.Mock;
  getOrgStores: jest.Mock;
};
const mockedPrisma = prisma as unknown as { $transaction: jest.Mock };

const ORG = 'org-1';

const base = {
  firstName: 'Rico',
  lastName: 'Bautista',
  email: 'rico@example.com',
  role: 'SELLER_USER' as const,
  storeIds: ['store-1'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRepo.findUserByEmail.mockResolvedValue(null);
  mockedRepo.getOrgStores.mockResolvedValue([{ id: 'store-1' }]);
  mockedPrisma.$transaction.mockResolvedValue({
    id: 'user-new',
    email: base.email,
    firstName: 'Rico',
  });
});

describe('OrganizationService.createStaffAccount', () => {
  it('creates the account and returns a set-up code rather than a password', async () => {
    const result = await OrganizationService.createStaffAccount(ORG, base);

    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.userId).toBe('user-new');
    expect(result.storeIds).toEqual(['store-1']);
    // A long random code, not a four-digit self-service one: an admin relays it
    // by hand and it lives for days.
    expect(result.setupCode).toMatch(/^[0-9a-f]{24}$/);
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('refuses an email that already has an account and points at the other path', async () => {
    mockedRepo.findUserByEmail.mockResolvedValue({ id: 'user-existing', email: base.email });

    await expect(OrganizationService.createStaffAccount(ORG, base)).rejects.toMatchObject({
      status: 409,
    });
    // Nothing is written — no half-made user.
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('normalises the email before the duplicate check', async () => {
    await OrganizationService.createStaffAccount(ORG, { ...base, email: '  RICO@Example.COM ' });

    expect(mockedRepo.findUserByEmail).toHaveBeenCalledWith('rico@example.com');
  });

  it('refuses a store that belongs to another organization', async () => {
    // getOrgStores is scoped to the org, so a foreign id simply does not come
    // back and the count check fails.
    mockedRepo.getOrgStores.mockResolvedValue([]);

    await expect(
      OrganizationService.createStaffAccount(ORG, { ...base, storeIds: ['store-elsewhere'] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores store assignments for an admin role', async () => {
    // An admin reaches every store the org owns, so enumerating stores for them
    // would be a lie that goes stale the moment a store is added.
    const result = await OrganizationService.createStaffAccount(ORG, {
      ...base,
      role: 'SELLER_ADMIN',
      storeIds: ['store-1'],
    });

    expect(result.storeIds).toEqual([]);
    expect(mockedRepo.getOrgStores).not.toHaveBeenCalled();
  });

  it('connects the new user to the platform SELLER role and creates no Sellers row', async () => {
    // A Sellers row would let staff complete merchant onboarding as an
    // independent competitor of the organization that hired them — see the
    // doc comment on createStaffAccount. Their authority comes from the
    // SellerOrganizationMemberStores assignment instead.
    const tx = {
      users: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'user-new', email: base.email, firstName: 'Rico' }),
      },
      sellers: { create: jest.fn() },
      sellerOrganizationMembers: {
        create: jest.fn().mockResolvedValue({ id: 'member-1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      sellerOrganizationMemberStores: { createMany: jest.fn() },
    };
    mockedPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

    await OrganizationService.createStaffAccount(ORG, base);

    expect(tx.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roles: { connect: [{ roleName: 'SELLER' }] },
        }),
      }),
    );
    expect(tx.sellers.create).not.toHaveBeenCalled();
    expect(tx.sellerOrganizationMembers.create).toHaveBeenCalledWith({
      data: {
        sellerOrganizationId: ORG,
        userId: 'user-new',
        role: base.role,
        permissions: ['orders', 'products'],
      },
    });
    expect(tx.sellerOrganizationMemberStores.createMany).toHaveBeenCalledWith({
      data: [{ memberId: 'member-1', storeId: 'store-1' }],
    });
  });

  it('builds the setup URL from the configured web app origin, not a raw env var', async () => {
    const result = await OrganizationService.createStaffAccount(ORG, base);

    expect(result.setupUrl.startsWith('http://localhost:4000/set-password?')).toBe(true);
  });

  describe('feature permissions', () => {
    it('defaults a SELLER_USER to orders and products', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, base);

      expect(result.permissions).toEqual(['orders', 'products']);
    });

    it('defaults a MANAGER to every feature', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        role: 'MANAGER',
      });

      expect(result.permissions).toEqual([
        'orders',
        'products',
        'promotions',
        'sales_review',
        'customer_review',
      ]);
    });

    it('honours an explicit list over the role default', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        role: 'MANAGER',
        permissions: ['orders'],
      });

      expect(result.permissions).toEqual(['orders']);
    });

    it('persists an explicit empty list as empty rather than re-inflating it', async () => {
      // The reason defaults are resolved at write time — otherwise an admin
      // could never actually revoke everything.
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        permissions: [],
      });

      expect(result.permissions).toEqual([]);
    });

    it('stores nothing for an admin, who holds every feature implicitly', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        role: 'SELLER_ADMIN',
        permissions: ['orders'],
      });

      expect(result.permissions).toEqual([]);
    });

    it('rejects an unknown code before creating anything', async () => {
      await expect(
        OrganizationService.createStaffAccount(ORG, {
          ...base,
          permissions: ['orders', 'not_a_feature'],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('de-duplicates a repeated code', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        permissions: ['orders', 'orders', 'products'],
      });

      expect(result.permissions).toEqual(['orders', 'products']);
    });
  });
});
