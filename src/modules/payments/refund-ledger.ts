import { CHARGEBENEFICIARY, CHARGEPAYER, ORDERCHARGETYPE, Prisma } from '@prisma/client';

/** The `source` of the row this writes, and how earlier ones are found again. */
export const GATEWAY_FEE_KEPT_SOURCE = 'Gateway fee kept on refund';

export interface GatewayFeeKeptInput {
  orderId: string;
  /** What the payment captured in total. */
  paymentAmount: number;
  /** Everything refunded on the payment so far, including the refund being recorded. */
  totalRefunded: number;
  /** The provider's id for this refund, if it gave one. */
  refundReference?: string | null;
}

/**
 * Record the gateway fee the platform absorbs on a refund (F86, decided on #118).
 *
 * A refund gives the buyer back everything they paid, the payment fee included,
 * but the gateway keeps the fee it charged on the original payment. The platform
 * pays that difference and the seller is not charged for it. Nothing used to
 * record it, so the cost only surfaced in a reconciliation. This writes it to
 * the order's ledger as a `REFUND` row, `PLATFORM` → `PAYMENT_PROVIDER`.
 *
 * The amount is the order's gateway fee (its `PAYMENT_PROCESSING_FEE` row) in
 * proportion to how much of the payment has been refunded. It is worked out
 * cumulatively, as "fee owed on everything refunded so far, minus what earlier
 * refunds already recorded", so partial refunds add up to the fee exactly with
 * no rounding drift, and a full refund records the whole fee.
 *
 * Call it inside the transaction that records the refund, and only for refunds
 * that went through a gateway; cash never paid a gateway fee. Writes nothing when
 * the order has no gateway fee recorded or nothing is left to record.
 *
 * Returns the amount written, or 0.
 */
export async function recordGatewayFeeKeptOnRefund(
  tx: Prisma.TransactionClient,
  { orderId, paymentAmount, totalRefunded, refundReference }: GatewayFeeKeptInput,
): Promise<number> {
  if (paymentAmount <= 0 || totalRefunded <= 0) return 0;

  const feeRows = await tx.orderCharges.findMany({
    where: { orderId, type: ORDERCHARGETYPE.PAYMENT_PROCESSING_FEE },
    select: { amount: true },
  });
  const gatewayFee = sumAmounts(feeRows);
  if (gatewayFee <= 0) return 0;

  const recordedRows = await tx.orderCharges.findMany({
    where: { orderId, type: ORDERCHARGETYPE.REFUND, source: GATEWAY_FEE_KEPT_SOURCE },
    select: { amount: true },
  });
  const alreadyRecorded = sumAmounts(recordedRows);

  const share = Math.min(1, totalRefunded / paymentAmount);
  const owedSoFar = toCents(gatewayFee * share);
  const amount = Number(((owedSoFar - toCents(alreadyRecorded)) / 100).toFixed(2));
  if (amount <= 0) return 0;

  await tx.orderCharges.create({
    data: {
      orderId,
      type: ORDERCHARGETYPE.REFUND,
      source: GATEWAY_FEE_KEPT_SOURCE,
      description:
        `The gateway keeps its fee on a refunded payment; the platform absorbs it (F86).` +
        (refundReference ? ` Refund ${refundReference}.` : ''),
      rate: new Prisma.Decimal(share.toFixed(5)),
      amount: new Prisma.Decimal(amount.toFixed(2)),
      payer: CHARGEPAYER.PLATFORM,
      beneficiary: CHARGEBENEFICIARY.PAYMENT_PROVIDER,
    },
  });

  return amount;
}

const toCents = (value: number) => Math.round(value * 100);

const sumAmounts = (rows: { amount: Prisma.Decimal | number | string }[]) =>
  rows.reduce((total, row) => total + Number(row.amount), 0);
