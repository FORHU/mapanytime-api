import { validateOrderTransition } from '../../src/modules/orders/order.state';
import { ORDERSTATUS } from '@prisma/client';

describe('Order State Machine (order.state.ts)', () => {
  describe('validateOrderTransition', () => {
    it('allows valid transitions from PENDING', () => {
      expect(() => validateOrderTransition('PENDING', 'PROCESSING')).not.toThrow();
      expect(() => validateOrderTransition('PENDING', 'CANCELLED')).not.toThrow();
      expect(() => validateOrderTransition('PENDING', 'FAILED')).not.toThrow();
    });

    it('allows valid transitions from PROCESSING', () => {
      expect(() => validateOrderTransition('PROCESSING', 'READY_FOR_PICKUP')).not.toThrow();
      expect(() => validateOrderTransition('PROCESSING', 'CANCELLED')).not.toThrow();
    });

    it('allows valid transitions from READY_FOR_PICKUP', () => {
      expect(() => validateOrderTransition('READY_FOR_PICKUP', 'COMPLETED')).not.toThrow();
      expect(() => validateOrderTransition('READY_FOR_PICKUP', 'CANCELLED')).not.toThrow();
    });

    it('allows no-op transition when status is unchanged', () => {
      expect(() => validateOrderTransition('PENDING', 'PENDING')).not.toThrow();
      expect(() => validateOrderTransition('COMPLETED', 'COMPLETED')).not.toThrow();
      expect(() => validateOrderTransition('CANCELLED', 'CANCELLED')).not.toThrow();
    });

    it('rejects illegal status jump from PENDING directly to COMPLETED', () => {
      expect(() => validateOrderTransition('PENDING', 'COMPLETED')).toThrow(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining(
            "Invalid order status transition from 'PENDING' to 'COMPLETED'",
          ),
        }),
      );
    });

    it('rejects modification from terminal state COMPLETED', () => {
      expect(() => validateOrderTransition('COMPLETED', 'CANCELLED')).toThrow(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining(
            "Cannot change status of an order that is already in terminal state 'COMPLETED'",
          ),
        }),
      );
    });

    it('rejects modification from terminal state CANCELLED', () => {
      expect(() => validateOrderTransition('CANCELLED', 'COMPLETED')).toThrow(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining(
            "Cannot change status of an order that is already in terminal state 'CANCELLED'",
          ),
        }),
      );
    });

    it('rejects modification from terminal state FAILED', () => {
      expect(() => validateOrderTransition('FAILED', 'PROCESSING')).toThrow(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining(
            "Cannot change status of an order that is already in terminal state 'FAILED'",
          ),
        }),
      );
    });
  });
});
