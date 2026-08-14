import ProductService from '../../src/modules/products/product.service';
import ProductRepository from '../../src/modules/products/product.repository';

jest.mock('../../src/modules/products/product.repository');

type SellerRow = Awaited<ReturnType<typeof ProductRepository.getSellerByUserId>>;
type StoreRow = Awaited<ReturnType<typeof ProductRepository.getStoreById>>;
type ProductRow = Awaited<ReturnType<typeof ProductRepository.getMyProducts>>['items'][number];

const mockedRepo = ProductRepository as unknown as {
  getSellerByUserId: jest.Mock<
    Promise<Partial<NonNullable<SellerRow>> | null>,
    Parameters<typeof ProductRepository.getSellerByUserId>
  >;
  getStoreById: jest.Mock<
    Promise<Partial<NonNullable<StoreRow>> | null>,
    Parameters<typeof ProductRepository.getStoreById>
  >;
  getMyProducts: jest.Mock<
    Promise<{ items: Array<Partial<ProductRow>>; total: number }>,
    Parameters<typeof ProductRepository.getMyProducts>
  >;
};

const SELLER = { id: 'seller-1' };
const STORE = { id: 'store-1', sellerId: 'seller-1' };

describe('ProductService.getMyProducts — server-side sorting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRepo.getSellerByUserId.mockResolvedValue(SELLER);
    mockedRepo.getStoreById.mockResolvedValue(STORE);
    mockedRepo.getMyProducts.mockResolvedValue({ items: [], total: 0 });
  });

  const base = { page: 1, limit: 10, skip: 0 };

  it('forwards sortBy/sortOrder to the repository', async () => {
    await ProductService.getMyProducts('user-1', 'store-1', {
      ...base,
      sortBy: 'price',
      sortOrder: 'asc',
    });

    expect(mockedRepo.getMyProducts).toHaveBeenCalledWith('store-1', {
      skip: 0,
      take: 10,
      search: undefined,
      categoryId: undefined,
      sortBy: 'price',
      sortOrder: 'asc',
    });
  });

  it('omits sort params when not requested (defaults to createdAt desc in repo)', async () => {
    await ProductService.getMyProducts('user-1', 'store-1', base);

    expect(mockedRepo.getMyProducts).toHaveBeenCalledWith('store-1', {
      skip: 0,
      take: 10,
      search: undefined,
      categoryId: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
  });

  it('returns the page envelope built from repo results', async () => {
    mockedRepo.getMyProducts.mockResolvedValue({ items: [{ id: 'p1' }], total: 1 });

    const result = await ProductService.getMyProducts('user-1', 'store-1', base);

    expect(result).toMatchObject({
      items: [{ id: 'p1' }],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('rejects with 403 when the seller does not own the store', async () => {
    mockedRepo.getStoreById.mockResolvedValue({
      id: 'store-2',
      sellerId: 'seller-2',
    });

    await expect(ProductService.getMyProducts('user-1', 'store-1', base)).rejects.toMatchObject({
      status: 403,
    });
    expect(mockedRepo.getMyProducts).not.toHaveBeenCalled();
  });
});
