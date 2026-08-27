import InventoryReservationRepository from '../../src/modules/inventory/inventoryReservation.repository';
import InventoryStockRepository from '../../src/modules/inventory/inventoryStock.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    inventoryReservations: { findMany: jest.fn() },
  },
}));
jest.mock('../../src/modules/inventory/inventoryStock.repository');

const mockFindMany = prisma.inventoryReservations.findMany as unknown as jest.Mock;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;
const mockRelease = InventoryStockRepository.releaseReservation as jest.Mock;

describe('InventoryReservationRepository.expireStaleReservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({}));
  });

  it('leaves a paid order’s hold alone, however late the pickup', async () => {
    // Holds stay RESERVED through payment now (F90), so this filter is the only
    // thing standing between a late collector and their goods being resold.
    mockFindMany.mockResolvedValue([]);

    await InventoryReservationRepository.expireStaleReservations();

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { orderId: null },
      { order: { status: { notIn: ['PROCESSING', 'READY_FOR_PICKUP'] } } },
    ]);
    expect(where.status).toBe('RESERVED');
  });

  it('re-claims each row inside its own transaction rather than trusting the read', async () => {
    mockFindMany.mockResolvedValue([{ id: 'res-1' }, { id: 'res-2' }]);
    mockRelease.mockResolvedValue(2);

    const expired = await InventoryReservationRepository.expireStaleReservations();

    expect(expired).toBe(2);
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), 'res-1', 'EXPIRED');
    expect(mockRelease).toHaveBeenCalledWith(expect.anything(), 'res-2', 'EXPIRED');
  });

  it('does not count a row another path claimed first', async () => {
    mockFindMany.mockResolvedValue([{ id: 'res-1' }, { id: 'res-2' }]);
    mockRelease.mockResolvedValueOnce(0).mockResolvedValueOnce(3);

    await expect(InventoryReservationRepository.expireStaleReservations()).resolves.toBe(1);
  });
});
