import PaymentService from '../../src/modules/payments/payment.service';
import { prisma } from '../../src/utils/prisma';
import { emitNotificationToUser } from '../../src/infrastructure/socket';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    orders: { findUnique: jest.fn() },
  },
}));

jest.mock('../../src/infrastructure/socket', () => ({
  emitNotificationToUser: jest.fn(),
}));

jest.mock('../../src/modules/payments/payment.repository', () => ({
  __esModule: true,
  default: { getPaymentByOrderId: jest.fn() },
}));

jest.mock('../../src/modules/products/product.repository', () => ({
  __esModule: true,
  default: { getSellerByUserId: jest.fn(), getStoreById: jest.fn() },
}));

const mockTransaction = prisma.$transaction as unknown as jest.Mock;
const mockOrdersFindUnique = prisma.orders.findUnique as unknown as jest.Mock;
const mockEmit = emitNotificationToUser as jest.Mock;

const ORDER_ID = 'order-1';

/** The `tx` handle the service receives inside prisma.$transaction. */
const makeTx = () => ({
  payments: { findFirst: jest.fn(), update: jest.fn() },
  orders: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  inventory: { updateMany: jest.fn() },
});

let tx: ReturnType<typeof makeTx>;

const amount = (value: number) => ({ toLocaleString: () => String(value) }) as unknown as number;

beforeEach(() => {
  jest.clearAllMocks();
  tx = makeTx();
  // Run the service's callback against the fake tx handle.
  mockTransaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
  mockOrdersFindUnique.mockResolvedValue(null);
});

describe('PaymentService.processMockWebhook', () => {
  it('rejects an unknown order', async () => {
    tx.payments.findFirst.mockResolvedValue(null);

    await expect(
      PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED', 'ref'),
    ).rejects.toMatchObject({ status: 404 });
  });

  describe('when the payment is already COMPLETED', () => {
    const completed = { id: 'pay-1', status: 'COMPLETED', amount: amount(500) };

    beforeEach(() => tx.payments.findFirst.mockResolvedValue(completed));

    it('does not write again', async () => {
      const result = await PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED', 'ref-2');

      // Gateways retry webhooks. A second COMPLETED must not re-run the side
      // effects — re-notifying the buyer or re-advancing the order.
      expect(result).toBe(completed);
      expect(tx.payments.update).not.toHaveBeenCalled();
      expect(tx.orders.updateMany).not.toHaveBeenCalled();
    });

    it('does not re-notify anyone', async () => {
      await PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED', 'ref-2');
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('cannot be moved back to FAILED', async () => {
      const result = await PaymentService.processMockWebhook(ORDER_ID, 'FAILED');

      expect(result).toBe(completed);
      expect(tx.inventory.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('COMPLETED', () => {
    beforeEach(() => {
      tx.payments.findFirst.mockResolvedValue({ id: 'pay-1', status: 'PENDING' });
      tx.payments.update.mockResolvedValue({
        id: 'pay-1',
        status: 'COMPLETED',
        amount: amount(500),
      });
    });

    it('requires a reference number', async () => {
      await expect(PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED')).rejects.toMatchObject({
        status: 400,
      });
      expect(tx.payments.update).not.toHaveBeenCalled();
    });

    it('stores the reference and a paidAt stamp', async () => {
      await PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED', 'ref-1');

      expect(tx.payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', referenceNumber: 'ref-1' }),
        }),
      );
      expect(tx.payments.update.mock.calls[0][0].data.paidAt).toBeInstanceOf(Date);
    });

    it('advances the order only while it is still PENDING', async () => {
      await PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED', 'ref-1');

      // The status:'PENDING' filter is what stops a late webhook from dragging
      // an already-shipped order back to PROCESSING.
      expect(tx.orders.updateMany).toHaveBeenCalledWith({
        where: { id: ORDER_ID, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
    });

    it('notifies both the buyer and the seller', async () => {
      mockOrdersFindUnique.mockResolvedValue({
        id: ORDER_ID,
        buyer: { userId: 'buyer-user' },
        store: { storeName: 'Shoe Shop', seller: { userId: 'seller-user' } },
      });

      await PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED', 'ref-1');

      expect(mockEmit).toHaveBeenCalledTimes(2);
      expect(mockEmit.mock.calls[0][0]).toBe('buyer-user');
      expect(mockEmit.mock.calls[1][0]).toBe('seller-user');
    });

    it('still returns the payment when notification delivery throws', async () => {
      mockOrdersFindUnique.mockRejectedValue(new Error('socket gone'));

      // Notifications are best-effort; a failure there must not turn a
      // successful payment into an error the gateway will retry.
      await expect(
        PaymentService.processMockWebhook(ORDER_ID, 'COMPLETED', 'ref-1'),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    });
  });

  describe('FAILED', () => {
    beforeEach(() => {
      tx.payments.findFirst.mockResolvedValue({ id: 'pay-1', status: 'PENDING' });
      tx.payments.update.mockResolvedValue({ id: 'pay-1', status: 'FAILED', amount: amount(500) });
    });

    it('releases the reserved stock for every order item', async () => {
      tx.orders.findUnique.mockResolvedValue({
        status: 'PENDING',
        orderitems: [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 3 },
        ],
      });

      await PaymentService.processMockWebhook(ORDER_ID, 'FAILED');

      // Not releasing here leaks reservations: the stock stays invisible to
      // every other buyer until someone notices by hand.
      expect(tx.inventory.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.inventory.updateMany).toHaveBeenCalledWith({
        where: { productId: 'p1' },
        data: { quantityReserved: { decrement: 2 } },
      });
      expect(tx.orders.update).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: { status: 'FAILED' },
      });
    });

    it('leaves stock alone when the order has already moved on', async () => {
      tx.orders.findUnique.mockResolvedValue({
        status: 'SHIPPED',
        orderitems: [{ productId: 'p1', quantity: 2 }],
      });

      await PaymentService.processMockWebhook(ORDER_ID, 'FAILED');

      // A shipped order's reservation was already consumed; decrementing again
      // would credit back stock that physically left the store.
      expect(tx.inventory.updateMany).not.toHaveBeenCalled();
      expect(tx.orders.update).not.toHaveBeenCalled();
    });

    it('sends no notifications', async () => {
      tx.orders.findUnique.mockResolvedValue({ status: 'PENDING', orderitems: [] });

      await PaymentService.processMockWebhook(ORDER_ID, 'FAILED');
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
