import InventoryStockRepository from '../../src/modules/inventory/inventoryStock.repository';

/**
 * These cover the two races that made inventory drift — F43 (stock handed back
 * twice) and F75 (the last unit sold twice) — so they assert the shape of the
 * SQL guards, not just the return values. A conditional UPDATE that quietly
 * loses its WHERE clause still returns the right numbers to a mock.
 */

type MockClient = {
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
  inventory: { update: jest.Mock };
};

const makeClient = (): MockClient => ({
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  inventory: { update: jest.fn().mockResolvedValue({}) },
});

/** The interpolated values of a tagged-template call, in order. */
const boundValues = (call: unknown[]) => call.slice(1);
/** The literal SQL of a tagged-template call, with `?` where a value went. */
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?');

describe('InventoryStockRepository.tryReserve', () => {
  it('reserves when the row still has the stock, and binds id and quantity', async () => {
    const client = makeClient();
    client.$executeRaw.mockResolvedValue(1);

    const result = await InventoryStockRepository.tryReserve(client as never, 'inv-1', 2);

    expect(result).toBe(true);
    expect(boundValues(client.$executeRaw.mock.calls[0])).toEqual([2, 'inv-1', 2]);
  });

  it('tests availability inside the UPDATE rather than before it', async () => {
    const client = makeClient();
    client.$executeRaw.mockResolvedValue(1);

    await InventoryStockRepository.tryReserve(client as never, 'inv-1', 2);

    // Without this predicate two concurrent checkouts both pass an earlier
    // read and oversell the last unit.
    expect(sqlOf(client.$executeRaw.mock.calls[0])).toContain(
      '"quantityOnHand" - "quantityReserved" >= ',
    );
  });

  it('refuses when the row no longer has the stock', async () => {
    const client = makeClient();
    client.$executeRaw.mockResolvedValue(0);

    await expect(InventoryStockRepository.tryReserve(client as never, 'inv-1', 2)).resolves.toBe(
      false,
    );
  });
});

describe('InventoryStockRepository.releaseOrderReservations', () => {
  it('gives back exactly the holds it claimed', async () => {
    const client = makeClient();
    client.$queryRaw.mockResolvedValue([
      { inventoryId: 'inv-1', quantity: 2 },
      { inventoryId: 'inv-2', quantity: 1 },
    ]);

    const released = await InventoryStockRepository.releaseOrderReservations(
      client as never,
      'order-1',
      'RELEASED',
    );

    expect(released).toBe(3);
    expect(client.inventory.update).toHaveBeenCalledTimes(2);
    expect(client.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ quantityReserved: { decrement: 2 } }),
      }),
    );
  });

  it('releases nothing when the sweeper already expired the hold', async () => {
    // F43: the order's items still say "2 units", but the reservation rows are
    // no longer RESERVED, so there is nothing left to give back. Decrementing
    // from the items here is what drove quantityReserved negative.
    const client = makeClient();
    client.$queryRaw.mockResolvedValue([]);

    const released = await InventoryStockRepository.releaseOrderReservations(
      client as never,
      'order-1',
      'RELEASED',
    );

    expect(released).toBe(0);
    expect(client.inventory.update).not.toHaveBeenCalled();
  });

  it('claims only rows still held, and records why the hold ended', async () => {
    const client = makeClient();
    client.$queryRaw.mockResolvedValue([]);

    await InventoryStockRepository.releaseOrderReservations(client as never, 'order-1', 'CONSUMED');

    const call = client.$queryRaw.mock.calls[0];
    expect(sqlOf(call)).toContain(`"status" = 'RESERVED'`);
    expect(boundValues(call)).toEqual(['CONSUMED', 'order-1']);
  });

  it('folds two holds on one inventory row into a single decrement', async () => {
    const client = makeClient();
    client.$queryRaw.mockResolvedValue([
      { inventoryId: 'inv-1', quantity: 2 },
      { inventoryId: 'inv-1', quantity: 3 },
    ]);

    const released = await InventoryStockRepository.releaseOrderReservations(
      client as never,
      'order-1',
      'RELEASED',
    );

    expect(released).toBe(5);
    expect(client.inventory.update).toHaveBeenCalledTimes(1);
    expect(client.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantityReserved: { decrement: 5 } }),
      }),
    );
  });
});

describe('InventoryStockRepository.releaseReservation', () => {
  it('gives back the claimed quantity', async () => {
    const client = makeClient();
    client.$queryRaw.mockResolvedValue([{ inventoryId: 'inv-1', quantity: 4 }]);

    const released = await InventoryStockRepository.releaseReservation(
      client as never,
      'res-1',
      'EXPIRED',
    );

    expect(released).toBe(4);
    expect(client.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ quantityReserved: { decrement: 4 } }),
      }),
    );
  });

  it('is a no-op when another path claimed the row first', async () => {
    const client = makeClient();
    client.$queryRaw.mockResolvedValue([]);

    const released = await InventoryStockRepository.releaseReservation(
      client as never,
      'res-1',
      'EXPIRED',
    );

    expect(released).toBe(0);
    expect(client.inventory.update).not.toHaveBeenCalled();
  });
});
