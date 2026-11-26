import {
  GATEWAY_FEE_KEPT_SOURCE,
  recordGatewayFeeKeptOnRefund,
} from '../../src/modules/payments/refund-ledger';

/**
 * A refund gives the buyer back the payment fee too, but the gateway keeps its
 * fee, so the platform absorbs it. Decided on #118 (F86): record it as a
 * PLATFORM-payer row instead of letting it vanish.
 */
describe('recordGatewayFeeKeptOnRefund (F86)', () => {
  /** A transaction whose ledger holds `fee` as the gateway cost plus any earlier rows. */
  const ledger = (fee: number | null, recorded: number[] = []) => {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      orderCharges: {
        findMany: jest.fn(({ where }: { where: { type: string } }) =>
          Promise.resolve(
            where.type === 'PAYMENT_PROCESSING_FEE'
              ? fee === null
                ? []
                : [{ amount: fee }]
              : [...recorded, ...created.map((row) => Number(String(row.amount)))].map(
                  (amount) => ({ amount }),
                ),
          ),
        ),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve(data);
        }),
      },
    };
    return { tx: tx as never, created };
  };

  it('records the whole gateway fee on a full refund, paid by the platform to the provider', async () => {
    const { tx, created } = ledger(22.3);

    const amount = await recordGatewayFeeKeptOnRefund(tx, {
      orderId: 'order-1',
      paymentAmount: 1022.3,
      totalRefunded: 1022.3,
      refundReference: 'ref_123',
    });

    expect(amount).toBe(22.3);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      orderId: 'order-1',
      type: 'REFUND',
      source: GATEWAY_FEE_KEPT_SOURCE,
      payer: 'PLATFORM',
      beneficiary: 'PAYMENT_PROVIDER',
    });
    expect(String(created[0].amount)).toBe('22.3');
    expect(String(created[0].description)).toContain('ref_123');
  });

  it('splits the fee across partial refunds so they add up to it exactly', async () => {
    const { tx, created } = ledger(22.31);
    const pay = 300;

    for (const totalRefunded of [100, 200, 300]) {
      await recordGatewayFeeKeptOnRefund(tx, {
        orderId: 'order-1',
        paymentAmount: pay,
        totalRefunded,
      });
    }

    const amounts = created.map((row) => Number(String(row.amount)));
    expect(amounts).toEqual([7.44, 7.43, 7.44]);
    expect(Number(amounts.reduce((a, b) => a + b, 0).toFixed(2))).toBe(22.31);
  });

  it('writes nothing when the order has no gateway fee', async () => {
    const { tx, created } = ledger(null);

    await expect(
      recordGatewayFeeKeptOnRefund(tx, {
        orderId: 'order-1',
        paymentAmount: 500,
        totalRefunded: 500,
      }),
    ).resolves.toBe(0);
    expect(created).toHaveLength(0);
  });

  it('writes nothing when the fee is already fully recorded', async () => {
    const { tx, created } = ledger(22.3, [22.3]);

    await expect(
      recordGatewayFeeKeptOnRefund(tx, {
        orderId: 'order-1',
        paymentAmount: 1022.3,
        totalRefunded: 1022.3,
      }),
    ).resolves.toBe(0);
    expect(created).toHaveLength(0);
  });

  it('never records more than the fee, even if refunds exceed the payment', async () => {
    const { tx } = ledger(10);

    await expect(
      recordGatewayFeeKeptOnRefund(tx, {
        orderId: 'order-1',
        paymentAmount: 100,
        totalRefunded: 150,
      }),
    ).resolves.toBe(10);
  });
});
