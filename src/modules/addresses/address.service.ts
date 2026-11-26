import { ADDRESSTYPE, Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

/** A buyer address as the API accepts it. */
export interface AddressInput {
  addressType?: ADDRESSTYPE;
  recipientName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string | null;
  barangay?: string | null;
  city?: string | null;
  province?: string | null;
  zipCode?: string | null;
  country?: string;
  isDefault?: boolean;
}

/** Either the root client or the client inside `prisma.$transaction`. */
type Db = Prisma.TransactionClient;

/** Default address first, then newest. */
const LIST_ORDER: Prisma.BuyerAddressesOrderByWithRelationInput[] = [
  { isDefault: 'desc' },
  { createdAt: 'desc' },
];

/**
 * Buyer addresses.
 *
 * `BuyerAddresses` existed with no endpoint. Every route resolves the buyer
 * from the token — an address id from the client is only ever looked up
 * within that buyer's own rows, so another buyer's address reads as 404.
 *
 * Invariants kept here: a buyer with addresses has exactly one default; the
 * first address is the default; deleting the default promotes the newest
 * remaining one.
 */
export default class AddressService {
  private static async resolveBuyerId(userId: string) {
    const buyer = await prisma.buyers.findUnique({ where: { userId } });
    if (!buyer) throw { status: 403, message: 'Only registered buyers have addresses.' };
    return buyer.id;
  }

  private static async findOwned(db: Db, buyerId: string, id: string) {
    const address = await db.buyerAddresses.findFirst({ where: { id, buyerId } });
    if (!address) throw { status: 404, message: 'Address not found' };
    return address;
  }

  private static async clearDefault(db: Db, buyerId: string) {
    await db.buyerAddresses.updateMany({
      where: { buyerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  static async list(userId: string) {
    const buyerId = await this.resolveBuyerId(userId);
    return prisma.buyerAddresses.findMany({ where: { buyerId }, orderBy: LIST_ORDER });
  }

  /**
   * Adds an address for [buyerId] inside [db] — shared by `POST /addresses`
   * and sign-up so both follow the same rules. An address the buyer already
   * has (same first line, ignoring case and surrounding spaces) is returned
   * instead of a duplicate.
   */
  static async addForBuyer(db: Db, buyerId: string, input: AddressInput) {
    const addressLine1 = input.addressLine1.trim();

    const existing = await db.buyerAddresses.findFirst({
      where: { buyerId, addressLine1: { equals: addressLine1, mode: 'insensitive' } },
    });
    if (existing) {
      if (input.isDefault && !existing.isDefault) {
        await this.clearDefault(db, buyerId);
        const address = await db.buyerAddresses.update({
          where: { id: existing.id },
          data: { isDefault: true },
        });
        return { address, created: false };
      }
      return { address: existing, created: false };
    }

    const isFirst = (await db.buyerAddresses.count({ where: { buyerId } })) === 0;
    const isDefault = isFirst || input.isDefault === true;
    if (isDefault && !isFirst) await this.clearDefault(db, buyerId);

    const address = await db.buyerAddresses.create({
      data: {
        buyerId,
        addressType: input.addressType ?? 'HOME',
        recipientName: input.recipientName,
        phoneNumber: input.phoneNumber,
        addressLine1,
        addressLine2: input.addressLine2 ?? null,
        barangay: input.barangay ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        zipCode: input.zipCode ?? null,
        country: input.country ?? 'Philippines',
        isDefault,
      },
    });
    return { address, created: true };
  }

  static async add(userId: string, input: AddressInput) {
    const buyerId = await this.resolveBuyerId(userId);
    return prisma.$transaction((tx) => this.addForBuyer(tx, buyerId, input));
  }

  /**
   * Edits an address. `isDefault: true` makes it the default; `false` is
   * ignored, since the buyer must always have one (pick another instead).
   */
  static async update(userId: string, id: string, input: Partial<AddressInput>) {
    const buyerId = await this.resolveBuyerId(userId);
    return prisma.$transaction(async (tx) => {
      await this.findOwned(tx, buyerId, id);
      const { isDefault, ...fields } = input;
      if (isDefault) await this.clearDefault(tx, buyerId);
      return tx.buyerAddresses.update({
        where: { id },
        data: {
          ...fields,
          ...(fields.addressLine1 !== undefined && { addressLine1: fields.addressLine1.trim() }),
          ...(isDefault && { isDefault: true }),
        },
      });
    });
  }

  static async setDefault(userId: string, id: string) {
    const buyerId = await this.resolveBuyerId(userId);
    return prisma.$transaction(async (tx) => {
      await this.findOwned(tx, buyerId, id);
      await this.clearDefault(tx, buyerId);
      return tx.buyerAddresses.update({ where: { id }, data: { isDefault: true } });
    });
  }

  /** Deletes an address; if it was the default, the newest remaining one becomes it. */
  static async remove(userId: string, id: string) {
    const buyerId = await this.resolveBuyerId(userId);
    return prisma.$transaction(async (tx) => {
      const address = await this.findOwned(tx, buyerId, id);
      await tx.buyerAddresses.delete({ where: { id } });
      if (address.isDefault) {
        const next = await tx.buyerAddresses.findFirst({
          where: { buyerId },
          orderBy: { createdAt: 'desc' },
        });
        if (next) {
          await tx.buyerAddresses.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
      return null;
    });
  }
}
