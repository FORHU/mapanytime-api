import InventoryService from '../../src/modules/inventory/inventory.service';
import InventoryRepository from '../../src/modules/inventory/inventory.repository';
import ProductRepository from '../../src/modules/products/product.repository';
import { prisma } from '../../src/utils/prisma';
import type { AuthUser } from '../../src/modules/auth/auth.repository';

jest.mock('../../src/modules/inventory/inventory.repository');
jest.mock('../../src/modules/products/product.repository');
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    sellers: { findUnique: jest.fn() },
    stores: { findMany: jest.fn() },
  },
}));

const mockedInventoryRepo = InventoryRepository as jest.Mocked<typeof InventoryRepository>;

type SellerRow = Awaited<ReturnType<typeof ProductRepository.getSellerByUserId>>;
type SellerMock = Partial<Omit<NonNullable<SellerRow>, 'applicationStatus'>> & {
  applicationStatus?: string;
};
type ProductRow = Awaited<ReturnType<typeof ProductRepository.getProductById>>;

const mockedProductRepo = ProductRepository as unknown as {
  getSellerByUserId: jest.Mock<Promise<SellerMock | null>, [string]>;
  getProductById: jest.Mock<Promise<Partial<NonNullable<ProductRow>> | null>, [string]>;
};
const mockedPrisma = prisma as unknown as {
  sellers: { findUnique: jest.Mock };
  stores: { findMany: jest.Mock };
};

const PRODUCT = { id: 'product-1', storeId: 'store-1' };

/** A merchant who owns store-1 outright and belongs to no organization. */
const OWNER = {
  id: 'user-1',
  orgMemberships: [],
  seller: { sellerOrganizationId: null },
} as unknown as AuthUser;

/** Organization staff assigned store-1, with no `Sellers` row of their own. */
const STAFF = {
  id: 'user-2',
  orgMemberships: [
    {
      sellerOrganizationId: 'org-1',
      role: 'SELLER_USER',
      assignedStores: [{ storeId: 'store-1' }],
    },
  ],
  seller: null,
} as unknown as AuthUser;

beforeEach(() => {
  jest.clearAllMocks();
  mockedProductRepo.getSellerByUserId.mockResolvedValue({
    id: 'seller-1',
    applicationStatus: 'APPROVED',
  });
  mockedProductRepo.getProductById.mockResolvedValue(PRODUCT);
  // Owner path: the caller's own Sellers row carries store-1.
  mockedPrisma.sellers.findUnique.mockResolvedValue({
    id: 'seller-1',
    stores: [{ id: 'store-1' }],
  });
  mockedPrisma.stores.findMany.mockResolvedValue([]);
});

describe('InventoryService.adjust', () => {
  it('delegates the absolute target quantity to the repository', async () => {
    mockedInventoryRepo.adjust.mockResolvedValue({
      productId: 'product-1',
      quantityOnHand: 15,
      changed: true,
    });

    const result = await InventoryService.adjust(OWNER, 'product-1', 15);

    expect(mockedInventoryRepo.adjust).toHaveBeenCalledWith('product-1', 15, 'user-1');
    expect(result).toEqual({ productId: 'product-1', quantityOnHand: 15, changed: true });
  });

  it('rejects with 403 when the caller owns a seller profile that is not approved', async () => {
    mockedProductRepo.getSellerByUserId.mockResolvedValue({
      id: 'seller-1',
      applicationStatus: 'PENDING',
    });

    await expect(InventoryService.adjust(OWNER, 'product-1', 10)).rejects.toMatchObject({
      status: 403,
    });
    expect(mockedInventoryRepo.adjust).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the product does not exist', async () => {
    mockedProductRepo.getProductById.mockResolvedValue(null);

    await expect(InventoryService.adjust(OWNER, 'product-1', 10)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockedInventoryRepo.adjust).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the store is outside the caller scope', async () => {
    // 404 rather than 403 so an out-of-scope store is indistinguishable from a
    // nonexistent one, matching the rest of the seller-organization code.
    mockedPrisma.sellers.findUnique.mockResolvedValue({ id: 'seller-1', stores: [] });

    await expect(InventoryService.adjust(OWNER, 'product-1', 10)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockedInventoryRepo.adjust).not.toHaveBeenCalled();
  });

  it('lets organization staff adjust stock in a store assigned to them', async () => {
    // The regression this port exists for: STAFF has no `Sellers` row, so the
    // old owner-identity check refused them on a store they were assigned.
    mockedProductRepo.getSellerByUserId.mockResolvedValue(null);
    mockedPrisma.sellers.findUnique.mockResolvedValue(null);
    mockedPrisma.stores.findMany.mockResolvedValue([{ id: 'store-1' }]);
    mockedInventoryRepo.adjust.mockResolvedValue({
      productId: 'product-1',
      quantityOnHand: 9,
      changed: true,
    });

    await InventoryService.adjust(STAFF, 'product-1', 9);

    expect(mockedInventoryRepo.adjust).toHaveBeenCalledWith('product-1', 9, 'user-2');
  });

  it('still refuses staff a store they were not assigned', async () => {
    mockedProductRepo.getSellerByUserId.mockResolvedValue(null);
    mockedPrisma.sellers.findUnique.mockResolvedValue(null);
    mockedPrisma.stores.findMany.mockResolvedValue([{ id: 'store-9' }]);

    await expect(InventoryService.adjust(STAFF, 'product-1', 9)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockedInventoryRepo.adjust).not.toHaveBeenCalled();
  });
});
