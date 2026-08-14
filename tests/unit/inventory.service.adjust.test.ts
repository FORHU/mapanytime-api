import InventoryService from '../../src/modules/inventory/inventory.service';
import InventoryRepository from '../../src/modules/inventory/inventory.repository';
import ProductRepository from '../../src/modules/products/product.repository';

jest.mock('../../src/modules/inventory/inventory.repository');
jest.mock('../../src/modules/products/product.repository');

const mockedInventoryRepo = InventoryRepository as jest.Mocked<typeof InventoryRepository>;

type SellerRow = Awaited<ReturnType<typeof ProductRepository.getSellerByUserId>>;
type SellerMock = Partial<Omit<NonNullable<SellerRow>, 'applicationStatus'>> & {
  applicationStatus?: string;
};
type ProductRow = Awaited<ReturnType<typeof ProductRepository.getProductById>>;
type StoreRow = Awaited<ReturnType<typeof ProductRepository.getStoreById>>;

const mockedProductRepo = ProductRepository as unknown as {
  getSellerByUserId: jest.Mock<
    Promise<SellerMock | null>,
    Parameters<typeof ProductRepository.getSellerByUserId>
  >;
  getProductById: jest.Mock<
    Promise<Partial<NonNullable<ProductRow>> | null>,
    Parameters<typeof ProductRepository.getProductById>
  >;
  getStoreById: jest.Mock<
    Promise<Partial<NonNullable<StoreRow>> | null>,
    Parameters<typeof ProductRepository.getStoreById>
  >;
};

const SELLER = { id: 'seller-1', applicationStatus: 'APPROVED' };
const PRODUCT = { id: 'product-1', storeId: 'store-1' };
const STORE = { id: 'store-1', sellerId: 'seller-1' };

describe('InventoryService.adjust', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedProductRepo.getSellerByUserId.mockResolvedValue(SELLER);
    mockedProductRepo.getProductById.mockResolvedValue(PRODUCT);
    mockedProductRepo.getStoreById.mockResolvedValue(STORE);
  });

  it('delegates the absolute target quantity to the repository', async () => {
    mockedInventoryRepo.adjust.mockResolvedValue({
      productId: 'product-1',
      quantityOnHand: 15,
      changed: true,
    });

    const result = await InventoryService.adjust('user-1', 'product-1', 15);

    expect(mockedInventoryRepo.adjust).toHaveBeenCalledWith('product-1', 15, 'user-1');
    expect(result).toEqual({ productId: 'product-1', quantityOnHand: 15, changed: true });
  });

  it('rejects with 403 when the seller is not approved', async () => {
    mockedProductRepo.getSellerByUserId.mockResolvedValue({
      id: 'seller-1',
      applicationStatus: 'PENDING',
    });

    await expect(InventoryService.adjust('user-1', 'product-1', 10)).rejects.toMatchObject({
      status: 403,
    });
    expect(mockedInventoryRepo.adjust).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the product does not exist', async () => {
    mockedProductRepo.getProductById.mockResolvedValue(null);

    await expect(InventoryService.adjust('user-1', 'product-1', 10)).rejects.toMatchObject({
      status: 404,
    });
    expect(mockedInventoryRepo.adjust).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the seller does not own the product store', async () => {
    mockedProductRepo.getStoreById.mockResolvedValue({
      id: 'store-2',
      sellerId: 'seller-2',
    });

    await expect(InventoryService.adjust('user-1', 'product-1', 10)).rejects.toMatchObject({
      status: 403,
    });
    expect(mockedInventoryRepo.adjust).not.toHaveBeenCalled();
  });
});
