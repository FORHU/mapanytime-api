import AddressService from '../../src/modules/addresses/address.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => {
  const buyerAddresses = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  };
  const client = {
    buyers: { findUnique: jest.fn() },
    buyerAddresses,
    // The transaction client is the same mock, so tx calls are observable.
    $transaction: jest.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(client));
  return { prisma: client };
});

const db = prisma as unknown as {
  buyers: { findUnique: jest.Mock };
  buyerAddresses: Record<
    'findMany' | 'findFirst' | 'count' | 'create' | 'update' | 'updateMany' | 'delete',
    jest.Mock
  >;
  $transaction: jest.Mock;
};
const a = db.buyerAddresses;

const INPUT = {
  recipientName: 'Juan Dela Cruz',
  phoneNumber: '+639171234567',
  addressLine1: '  123 Session Rd, Baguio City  ',
};

beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  db.buyers.findUnique.mockResolvedValue({ id: 'buyer-1' });
  a.findFirst.mockResolvedValue(null);
  a.count.mockResolvedValue(0);
  a.create.mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data }));
  a.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
});

describe('AddressService', () => {
  it('only serves registered buyers', async () => {
    db.buyers.findUnique.mockResolvedValue(null);
    await expect(AddressService.list('user-1')).rejects.toMatchObject({ status: 403 });
  });

  it("lists only the caller's addresses, default first then newest", async () => {
    a.findMany.mockResolvedValue([]);
    await AddressService.list('user-1');
    expect(db.buyers.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(a.findMany).toHaveBeenCalledWith({
      where: { buyerId: 'buyer-1' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  });

  describe('add', () => {
    it('makes the first address the default, trimmed, with optional parts null', async () => {
      const { address, created } = await AddressService.add('user-1', INPUT);

      expect(created).toBe(true);
      expect(a.create).toHaveBeenCalledWith({
        data: {
          buyerId: 'buyer-1',
          addressType: 'HOME',
          recipientName: 'Juan Dela Cruz',
          phoneNumber: '+639171234567',
          addressLine1: '123 Session Rd, Baguio City',
          addressLine2: null,
          barangay: null,
          city: null,
          province: null,
          zipCode: null,
          country: 'Philippines',
          isDefault: true,
        },
      });
      expect(address.isDefault).toBe(true);
      expect(a.updateMany).not.toHaveBeenCalled();
    });

    it('does not take the default from an existing one unless asked', async () => {
      a.count.mockResolvedValue(2);
      await AddressService.add('user-1', INPUT);
      expect(a.create.mock.calls[0][0].data.isDefault).toBe(false);
      expect(a.updateMany).not.toHaveBeenCalled();
    });

    it('moves the default when the new one is marked default', async () => {
      a.count.mockResolvedValue(2);
      await AddressService.add('user-1', { ...INPUT, isDefault: true });
      expect(a.updateMany).toHaveBeenCalledWith({
        where: { buyerId: 'buyer-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(a.create.mock.calls[0][0].data.isDefault).toBe(true);
    });

    it('returns the existing address instead of a duplicate', async () => {
      const existing = {
        id: 'addr-1',
        isDefault: true,
        addressLine1: '123 Session Rd, Baguio City',
      };
      a.findFirst.mockResolvedValue(existing);

      const { address, created } = await AddressService.add('user-1', {
        ...INPUT,
        addressLine1: '123 SESSION RD, BAGUIO CITY',
      });

      expect(created).toBe(false);
      expect(address).toBe(existing);
      expect(a.findFirst).toHaveBeenCalledWith({
        where: {
          buyerId: 'buyer-1',
          addressLine1: { equals: '123 SESSION RD, BAGUIO CITY', mode: 'insensitive' },
        },
      });
      expect(a.create).not.toHaveBeenCalled();
    });

    it('a duplicate marked default becomes the default', async () => {
      a.findFirst.mockResolvedValue({ id: 'addr-2', isDefault: false });
      const { created } = await AddressService.add('user-1', { ...INPUT, isDefault: true });

      expect(created).toBe(false);
      expect(a.updateMany).toHaveBeenCalled();
      expect(a.update).toHaveBeenCalledWith({ where: { id: 'addr-2' }, data: { isDefault: true } });
      expect(a.create).not.toHaveBeenCalled();
    });
  });

  describe('changing an address', () => {
    it("404s on another buyer's address", async () => {
      a.findFirst.mockResolvedValue(null);
      await expect(AddressService.update('user-1', 'theirs', { city: 'X' })).rejects.toMatchObject({
        status: 404,
      });
      await expect(AddressService.setDefault('user-1', 'theirs')).rejects.toMatchObject({
        status: 404,
      });
      await expect(AddressService.remove('user-1', 'theirs')).rejects.toMatchObject({
        status: 404,
      });
      expect(a.findFirst).toHaveBeenCalledWith({ where: { id: 'theirs', buyerId: 'buyer-1' } });
      expect(a.update).not.toHaveBeenCalled();
      expect(a.delete).not.toHaveBeenCalled();
    });

    it('updates fields, trimming the address line', async () => {
      a.findFirst.mockResolvedValue({ id: 'addr-1', isDefault: false });
      await AddressService.update('user-1', 'addr-1', { addressLine1: ' 45 Abanao St ' });
      expect(a.update).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        data: { addressLine1: '45 Abanao St' },
      });
      expect(a.updateMany).not.toHaveBeenCalled();
    });

    it('isDefault: true on update moves the default; false is ignored', async () => {
      a.findFirst.mockResolvedValue({ id: 'addr-1', isDefault: false });
      await AddressService.update('user-1', 'addr-1', { isDefault: true });
      expect(a.updateMany).toHaveBeenCalled();
      expect(a.update).toHaveBeenCalledWith({ where: { id: 'addr-1' }, data: { isDefault: true } });

      jest.clearAllMocks();
      db.buyers.findUnique.mockResolvedValue({ id: 'buyer-1' });
      a.findFirst.mockResolvedValue({ id: 'addr-1', isDefault: true });
      await AddressService.update('user-1', 'addr-1', { isDefault: false });
      expect(a.update).toHaveBeenCalledWith({ where: { id: 'addr-1' }, data: {} });
    });

    it('set default clears the old one first', async () => {
      a.findFirst.mockResolvedValue({ id: 'addr-2', isDefault: false });
      await AddressService.setDefault('user-1', 'addr-2');
      expect(a.updateMany).toHaveBeenCalledWith({
        where: { buyerId: 'buyer-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(a.update).toHaveBeenCalledWith({ where: { id: 'addr-2' }, data: { isDefault: true } });
    });

    it('deleting the default promotes the newest remaining address', async () => {
      a.findFirst
        .mockResolvedValueOnce({ id: 'addr-1', isDefault: true }) // the one deleted
        .mockResolvedValueOnce({ id: 'addr-3' }); // newest left
      await AddressService.remove('user-1', 'addr-1');

      expect(a.delete).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
      expect(a.findFirst).toHaveBeenLastCalledWith({
        where: { buyerId: 'buyer-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(a.update).toHaveBeenCalledWith({ where: { id: 'addr-3' }, data: { isDefault: true } });
    });

    it('deleting a non-default address leaves the default alone', async () => {
      a.findFirst.mockResolvedValue({ id: 'addr-2', isDefault: false });
      await AddressService.remove('user-1', 'addr-2');
      expect(a.delete).toHaveBeenCalled();
      expect(a.update).not.toHaveBeenCalled();
    });
  });
});
