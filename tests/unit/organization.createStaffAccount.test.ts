import OrganizationService from '../../src/modules/organization/organization.service';
import OrganizationRepository from '../../src/modules/organization/organization.repository';
import { publish } from '../../src/infrastructure/rabbitmq/publisher';
import { prisma } from '../../src/utils/prisma';
import { SYSTEM_ROLES } from '../../src/constants/roles.constant';
import { PERMISSIONS } from '../../src/constants/permissions.constant';
import { ALL_SELLER_FEATURES } from '../../src/modules/organization/sellerPermissions.constant';

jest.mock('../../src/modules/organization/organization.repository');
jest.mock('../../src/modules/auth/auth.service', () => ({
  __esModule: true,
  default: { storeResetCode: jest.fn() },
}));
jest.mock('../../src/infrastructure/rabbitmq/publisher', () => ({ publish: jest.fn() }));
jest.mock('../../src/utils/prisma', () => ({ prisma: { $transaction: jest.fn() } }));

/**
 * Pinned, because `src/config` calls `dotenv.config()` at import and jest has no
 * env isolation — so this suite reads whatever `.env` the developer happens to
 * have. This assertion used to depend on `MAPANYTIME_WEB_APP_URL` being *unset*,
 * which made it pass in CI (no .env) and fail on any machine that had configured
 * the variable.
 *
 * Mocking the module is the only thing that works: `MAPANYTIME_WEB_APP_URL` is a
 * module-level `export const` bound at import time, so setting `process.env` from
 * a test body — the pattern `payment.service.test.ts` uses — would be too late.
 */
jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  MAPANYTIME_WEB_APP_URL: 'https://app.test',
  // Links in email come from their own origin, because the one above is shaped
  // by Xendit's rules and in development points somewhere unreachable.
  MAPANYTIME_WEB_APP_EMAIL_URL: 'https://mail.test',
}));

const mockedRepo = OrganizationRepository as unknown as {
  findUserByEmail: jest.Mock;
  getOrgStores: jest.Mock;
};
const mockedPrisma = prisma as unknown as { $transaction: jest.Mock };
const mockedPublish = publish as jest.Mock;

/** The single EMAIL_SEND_REQUESTED payload, for asserting on what was sent. */
const publishedEmail = () => mockedPublish.mock.calls[0][1];

const ORG = 'org-1';

const base = {
  firstName: 'Rico',
  lastName: 'Bautista',
  email: 'rico@example.com',
  role: SYSTEM_ROLES.SELLER_MEMBER,
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
      role: SYSTEM_ROLES.SELLER_ADMIN,
      storeIds: ['store-1'],
    });

    expect(result.storeIds).toEqual([]);
    expect(mockedRepo.getOrgStores).not.toHaveBeenCalled();
  });

  it('connects the new user to the platform SELLER role and creates no Sellers row', async () => {
    // A Sellers row would let staff complete merchant onboarding as an
    // independent competitor of the organization that hired them — see the
    // doc comment on createStaffAccount. Their authority comes from the
    // store assignment on their membership row instead.
    const tx = {
      users: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'user-new', email: base.email, firstName: 'Rico' }),
      },
      sellers: { create: jest.fn() },
      sellerOrganizationMembers: {
        create: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
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
    // One insert: the store assignments ride on the member row now, so there is
    // no second write to keep consistent with it.
    expect(tx.sellerOrganizationMembers.create).toHaveBeenCalledWith({
      data: {
        sellerId: ORG,
        userId: 'user-new',
        role: SYSTEM_ROLES.SELLER_MEMBER,
        permissions: [PERMISSIONS.ORDERS_PROCESS, PERMISSIONS.PRODUCTS_VIEW],
        assignedStoreIds: ['store-1'],
      },
    });
  });

  it('builds the setup URL from the email origin, not the Xendit-shaped one', async () => {
    const result = await OrganizationService.createStaffAccount(ORG, base);

    expect(result.setupUrl.startsWith('https://mail.test/set-password?')).toBe(true);
    expect(result.setupUrl).not.toContain('app.test');
  });

  describe('the set-up email', () => {
    it('sends the link to the address the admin supplied', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, base);

      expect(mockedPublish).toHaveBeenCalledTimes(1);
      const email = publishedEmail();
      expect(email.email).toBe(base.email);
      expect(email.templateName).toBe('staff-setup.html');
      expect(email.data.setupUrl).toBe(result.setupUrl);
    });

    /**
     * The link used to be built twice — once for the email, once for the
     * response. Two constructions of the same URL are free to drift, and the
     * copy nobody reads is the one that rots.
     */
    it('sends the same code and link it hands back to the admin', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, base);
      const email = publishedEmail();

      expect(email.data.code).toBe(result.setupCode);
      expect(email.data.setupUrl).toContain(result.setupCode);
      expect(email.body).toContain(result.setupUrl);
    });

    it('states the expiry in days rather than raw minutes', async () => {
      await OrganizationService.createStaffAccount(ORG, base);

      // The TTL is stored as 4320 minutes; "expires in 4320 minutes" is true
      // and unreadable.
      expect(publishedEmail().data.expiresIn).toBe('3 days');
      expect(JSON.stringify(publishedEmail().data)).not.toContain('4320');
    });

    it('sends nothing when the account could not be created', async () => {
      mockedPrisma.$transaction.mockRejectedValue(new Error('constraint violation'));

      await expect(OrganizationService.createStaffAccount(ORG, base)).rejects.toThrow();
      // An email announcing an account that does not exist is worse than none.
      expect(mockedPublish).not.toHaveBeenCalled();
    });

    it('still creates the member when publishing the email fails', async () => {
      // `Once`, not `mockRejectedValue`: the suite's beforeEach uses
      // clearAllMocks, which clears recorded calls but leaves implementations
      // in place — a persistent rejection here would leak into every later test.
      mockedPublish.mockRejectedValueOnce(new Error('rabbitmq down'));

      // The member exists either way; mail being down must not turn a
      // successful creation into an error the admin sees.
      await expect(OrganizationService.createStaffAccount(ORG, base)).resolves.toMatchObject({
        userId: 'user-new',
      });
    });
  });

  describe('feature permissions', () => {
    it('defaults a SELLER_MEMBER to order processing and read-only catalog', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, base);

      expect(result.permissions).toEqual([PERMISSIONS.ORDERS_PROCESS, PERMISSIONS.PRODUCTS_VIEW]);
      // The member default must not carry write access to the catalog.
      expect(result.permissions).not.toContain(PERMISSIONS.PRODUCTS_EDIT);
    });

    it('defaults a SELLER_MANAGER to every feature', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        role: SYSTEM_ROLES.SELLER_MANAGER,
      });

      expect(result.permissions).toEqual([...ALL_SELLER_FEATURES]);
    });

    it('honours an explicit list over the role default', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        role: SYSTEM_ROLES.SELLER_MANAGER,
        permissions: [PERMISSIONS.ORDERS_PROCESS],
      });

      expect(result.permissions).toEqual([PERMISSIONS.ORDERS_PROCESS]);
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
        role: SYSTEM_ROLES.SELLER_ADMIN,
        permissions: [PERMISSIONS.ORDERS_PROCESS],
      });

      expect(result.permissions).toEqual([]);
    });

    it('rejects an unknown code before creating anything', async () => {
      await expect(
        OrganizationService.createStaffAccount(ORG, {
          ...base,
          permissions: [PERMISSIONS.ORDERS_PROCESS, 'not_a_feature'],
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('de-duplicates a repeated code', async () => {
      const result = await OrganizationService.createStaffAccount(ORG, {
        ...base,
        permissions: [
          PERMISSIONS.ORDERS_PROCESS,
          PERMISSIONS.ORDERS_PROCESS,
          PERMISSIONS.PRODUCTS_VIEW,
        ],
      });

      expect(result.permissions).toEqual([PERMISSIONS.ORDERS_PROCESS, PERMISSIONS.PRODUCTS_VIEW]);
    });
  });
});
