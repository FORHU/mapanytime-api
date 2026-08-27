import { Prisma, PrismaClient, RESERVATIONSTATUS } from '@prisma/client';

type DbClient = Prisma.TransactionClient | PrismaClient;

/** A reservation row this call actually claimed, and the stock it was holding. */
export interface ClaimedReservation {
  inventoryId: string;
  quantity: number;
}

/**
 * The single-statement stock primitives. Both exist because the read-then-write
 * pairs they replace were not atomic under Postgres' default READ COMMITTED:
 * two checkouts could each read the same `availableStock` and both reserve it
 * (oversell), and any release path that decremented straight from `orderitems`
 * could subtract stock a second time after the TTL sweeper had already given it
 * back (`quantityReserved` going negative, which then overstates availability).
 * See F43 and F75 in docs/specs/OPEN-FLAGS.md.
 *
 * Both are raw SQL because neither can be expressed in Prisma's typed API: one
 * compares two columns in a WHERE, the other needs the claimed rows RETURNED.
 * `updatedAt` is set by hand — `@updatedAt` is applied by the client, so a raw
 * UPDATE would otherwise leave it stale.
 */
export default class InventoryStockRepository {
  /**
   * Reserve stock if — and only if — it is still available at the moment the
   * row lock is taken. The `quantityOnHand - quantityReserved >= quantity`
   * comparison is re-evaluated against the latest committed row after the
   * UPDATE blocks on a concurrent writer, so the loser of a race for the last
   * unit matches no row and gets `false` rather than overselling.
   *
   * Returns whether the reservation was taken; callers turn `false` into their
   * own out-of-stock error so the message can name the product.
   */
  static async tryReserve(
    client: DbClient,
    inventoryId: string,
    quantity: number,
  ): Promise<boolean> {
    const affected = await client.$executeRaw`
      UPDATE "Inventory"
      SET "quantityReserved" = "quantityReserved" + ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "id" = ${inventoryId}
        AND "quantityOnHand" - "quantityReserved" >= ${quantity}
    `;
    return affected === 1;
  }

  /**
   * Flip an order's still-held reservations to `nextStatus` and return exactly
   * the rows this call moved. The status transition is the claim: a row already
   * moved by the TTL sweeper, a concurrent cancel, or a retry of this same
   * operation no longer matches `status = 'RESERVED'`, so it is returned to
   * nobody and its stock is released once, by whoever won.
   *
   * Callers must decrement `quantityReserved` from the returned rows and
   * nothing else — never from the order's items, which is what F43 was.
   */
  static async claimOrderReservations(
    client: DbClient,
    orderId: string,
    nextStatus: RESERVATIONSTATUS,
  ): Promise<ClaimedReservation[]> {
    return client.$queryRaw<ClaimedReservation[]>`
      UPDATE "InventoryReservations"
      SET "status" = ${nextStatus}::"RESERVATIONSTATUS",
          "updatedAt" = NOW()
      WHERE "orderId" = ${orderId}
        AND "status" = 'RESERVED'::"RESERVATIONSTATUS"
      RETURNING "inventoryId", "quantity"
    `;
  }

  /**
   * The single-row form of {@link claimOrderReservations}, for the paths that
   * hold one reservation id rather than an order: the TTL sweeper and the
   * buyer-facing release endpoint. Returns null when the row was already
   * claimed by someone else.
   */
  static async claimReservation(
    client: DbClient,
    reservationId: string,
    nextStatus: RESERVATIONSTATUS,
  ): Promise<ClaimedReservation | null> {
    const rows = await client.$queryRaw<ClaimedReservation[]>`
      UPDATE "InventoryReservations"
      SET "status" = ${nextStatus}::"RESERVATIONSTATUS",
          "updatedAt" = NOW()
      WHERE "id" = ${reservationId}
        AND "status" = 'RESERVED'::"RESERVATIONSTATUS"
      RETURNING "inventoryId", "quantity"
    `;
    return rows[0] ?? null;
  }

  /**
   * Claim one reservation and give its stock back. Returns the quantity
   * released, or 0 when the hold had already ended — which is the normal
   * outcome of a sweeper and a cancel racing for the same row, not an error.
   */
  static async releaseReservation(
    client: DbClient,
    reservationId: string,
    nextStatus: RESERVATIONSTATUS,
  ): Promise<number> {
    const claimed = await this.claimReservation(client, reservationId, nextStatus);
    if (!claimed) return 0;

    await client.inventory.update({
      where: { id: claimed.inventoryId },
      data: {
        quantityReserved: { decrement: claimed.quantity },
        version: { increment: 1 },
      },
    });

    return claimed.quantity;
  }

  /**
   * Claim an order's outstanding reservations and give the stock back. Safe to
   * call twice: the second call claims nothing and releases nothing.
   *
   * `nextStatus` records why the hold ended — CONSUMED when the sale completed,
   * RELEASED when the order was cancelled or its payment failed.
   */
  static async releaseOrderReservations(
    client: DbClient,
    orderId: string,
    nextStatus: RESERVATIONSTATUS,
  ): Promise<number> {
    const claimed = await this.claimOrderReservations(client, orderId, nextStatus);
    if (claimed.length === 0) return 0;

    // One order can hold several reservations against the same inventory row
    // (the same product added to a cart twice). Fold them so each row takes a
    // single update.
    const byInventory = new Map<string, number>();
    for (const row of claimed) {
      byInventory.set(row.inventoryId, (byInventory.get(row.inventoryId) ?? 0) + row.quantity);
    }

    for (const [inventoryId, quantity] of byInventory) {
      await client.inventory.update({
        where: { id: inventoryId },
        data: {
          quantityReserved: { decrement: quantity },
          version: { increment: 1 },
        },
      });
    }

    return claimed.reduce((sum, row) => sum + row.quantity, 0);
  }
}
