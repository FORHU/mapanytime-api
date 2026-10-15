/**
 * How long an unpaid order waits before the stale-order sweeper cancels it and
 * releases its stock (F44). Read by the scheduler.
 */
export const PENDING_ORDER_TTL_MINUTES = 15;

/**
 * How long a gateway checkout session stays payable. Shorter than
 * `PENDING_ORDER_TTL_MINUTES`, so a buyer cannot pay an order the sweeper has
 * already cancelled (F109): Xendit's default is 30 minutes. Xendit refuses an
 * expiry less than 10 minutes away, so 12 leaves room for clock drift on both
 * sides.
 */
export const CHECKOUT_SESSION_TTL_MINUTES = 12;
