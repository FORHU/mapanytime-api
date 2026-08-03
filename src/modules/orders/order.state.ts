import { ORDERSTATUS } from '@prisma/client';

/**
 * Strict Order State Machine Transition Matrix.
 * Enforces valid state transitions and prevents terminal state modification or illegal status jumps.
 */
export const ALLOWED_ORDER_TRANSITIONS: Record<ORDERSTATUS, ORDERSTATUS[]> = {
  PENDING: [ORDERSTATUS.PROCESSING, ORDERSTATUS.CANCELLED, ORDERSTATUS.FAILED],
  PROCESSING: [ORDERSTATUS.READY_FOR_PICKUP, ORDERSTATUS.CANCELLED],
  READY_FOR_PICKUP: [ORDERSTATUS.COMPLETED, ORDERSTATUS.CANCELLED],
  COMPLETED: [], // Terminal State
  CANCELLED: [], // Terminal State
  FAILED: [], // Terminal State
};

/**
 * Validates whether an order status transition from currentStatus to targetStatus is allowed.
 * Throws a formatted error object with HTTP status 400 if the transition is illegal.
 */
export function validateOrderTransition(
  currentStatus: ORDERSTATUS,
  targetStatus: ORDERSTATUS,
): void {
  if (currentStatus === targetStatus) {
    return; // No-op if status is unchanged
  }

  const allowed = ALLOWED_ORDER_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(targetStatus)) {
    const isTerminal = allowed.length === 0;
    const message = isTerminal
      ? `Cannot change status of an order that is already in terminal state '${currentStatus}'.`
      : `Invalid order status transition from '${currentStatus}' to '${targetStatus}'. Allowed next states: [${allowed.join(', ')}].`;

    throw { status: 400, message };
  }
}
