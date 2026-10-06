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
    it('releases reservation via repository when no userId is passed', async () => {
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

    it('releases reservation when caller owns the reservation', async () => {
      const mockReservation = {
        id: 'res-123',
        buyerId: 'buyer-1',
        status: 'RESERVED',
      };
      const mockReleased = {
        id: 'res-123',
        status: 'RELEASED',
      };

      (InventoryReservationRepository.findReservationById as jest.Mock).mockResolvedValue(
        mockReservation,
      );
      (InventoryReservationRepository.releaseReservation as jest.Mock).mockResolvedValue(
        mockReleased,
      );

      const result = await InventoryReservationService.releaseReservation('res-123', 'buyer-1');
      expect(result).toEqual(mockReleased);
      expect(InventoryReservationRepository.findReservationById).toHaveBeenCalledWith('res-123');
      expect(InventoryReservationRepository.releaseReservation).toHaveBeenCalledWith('res-123');
    });

    it('throws 404 if reservation does not exist', async () => {
      (InventoryReservationRepository.findReservationById as jest.Mock).mockResolvedValue(null);

      await expect(
        InventoryReservationService.releaseReservation('res-999', 'buyer-1'),
      ).rejects.toEqual({
        status: 404,
        message: 'Reservation not found.',
      });
    });

    it('throws 403 if caller does not own the reservation', async () => {
      const mockReservation = {
        id: 'res-123',
        buyerId: 'other-buyer',
        status: 'RESERVED',
      };

      (InventoryReservationRepository.findReservationById as jest.Mock).mockResolvedValue(
        mockReservation,
      );

      await expect(
        InventoryReservationService.releaseReservation('res-123', 'buyer-1'),
      ).rejects.toEqual({
        status: 403,
        message: 'You are not authorized to release this reservation.',
      });
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
