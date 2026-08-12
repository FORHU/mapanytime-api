import InventoryReservationService from '../../src/modules/inventory/inventoryReservation.service';
import InventoryReservationRepository from '../../src/modules/inventory/inventoryReservation.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/inventory/inventoryReservation.repository');
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    buyers: {
      findUnique: jest.fn(),
    },
  },
}));

describe('InventoryReservationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.buyers.findUnique as jest.Mock).mockResolvedValue({ id: 'buyer-1', userId: 'buyer-1' });
  });

  describe('reserveStock', () => {
    it('throws 400 error if quantity is <= 0', async () => {
      await expect(InventoryReservationService.reserveStock('buyer-1', 'inv-1', 0)).rejects.toEqual(
        {
          status: 400,
          message: 'Quantity to reserve must be greater than zero.',
        },
      );
    });

    it('creates reservation successfully with TTL calculated expiresAt', async () => {
      const mockReservation = {
        id: 'res-123',
        inventoryId: 'inv-1',
        buyerId: 'buyer-1',
        quantity: 2,
        status: 'RESERVED',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      };

      (InventoryReservationRepository.createReservation as jest.Mock).mockResolvedValue(
        mockReservation,
      );

      const result = await InventoryReservationService.reserveStock('buyer-1', 'inv-1', 2, 15);

      expect(result).toEqual(mockReservation);
      expect(InventoryReservationRepository.createReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          inventoryId: 'inv-1',
          buyerId: 'buyer-1',
          quantity: 2,
        }),
      );
    });

    it('wraps repository errors in 400 status exception', async () => {
      (InventoryReservationRepository.createReservation as jest.Mock).mockRejectedValue(
        new Error('Insufficient stock available for reservation.'),
      );

      await expect(
        InventoryReservationService.reserveStock('buyer-1', 'inv-1', 100),
      ).rejects.toEqual({
        status: 400,
        message: 'Insufficient stock available for reservation.',
      });
    });
  });

  describe('confirmReservation', () => {
    it('confirms reservation via repository', async () => {
      const mockConfirmed = {
        id: 'res-123',
        status: 'CONSUMED',
        orderId: 'order-99',
      };

      (InventoryReservationRepository.consumeReservation as jest.Mock).mockResolvedValue(
        mockConfirmed,
      );

      const result = await InventoryReservationService.confirmReservation('res-123', 'order-99');
      expect(result).toEqual(mockConfirmed);
      expect(InventoryReservationRepository.consumeReservation).toHaveBeenCalledWith(
        'res-123',
        'order-99',
      );
    });
  });

  describe('releaseReservation', () => {
    it('releases reservation via repository', async () => {
      const mockReleased = {
        id: 'res-123',
        status: 'RELEASED',
      };

      (InventoryReservationRepository.releaseReservation as jest.Mock).mockResolvedValue(
        mockReleased,
      );

      const result = await InventoryReservationService.releaseReservation('res-123');
      expect(result).toEqual(mockReleased);
      expect(InventoryReservationRepository.releaseReservation).toHaveBeenCalledWith('res-123');
    });
  });

  describe('processExpiredReservations', () => {
    it('triggers stale reservation cleanup', async () => {
      (InventoryReservationRepository.expireStaleReservations as jest.Mock).mockResolvedValue(3);

      const expiredCount = await InventoryReservationService.processExpiredReservations();
      expect(expiredCount).toBe(3);
      expect(InventoryReservationRepository.expireStaleReservations).toHaveBeenCalled();
    });
  });
});
