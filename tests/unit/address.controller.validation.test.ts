import { Request, Response } from 'express';
import AddressController from '../../src/modules/addresses/address.controller';
import AddressService from '../../src/modules/addresses/address.service';

jest.mock('../../src/modules/addresses/address.service');
jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const svc = AddressService as jest.Mocked<typeof AddressService>;

const VALID = {
  recipientName: 'Juan Dela Cruz',
  phoneNumber: '+639171234567',
  addressLine1: '123 Session Rd, Baguio City',
};

const call = async <P>(
  handler: (req: Request<P>, res: Response, next: jest.Mock) => Promise<unknown>,
  { body, params, user = { id: 'user-1' } }: { body?: unknown; params?: P; user?: unknown },
) => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })), json } as unknown as Response;
  const next = jest.fn();
  await handler({ body, params, user } as unknown as Request<P>, res, next);
  return {
    next,
    status: (res.status as jest.Mock).mock.calls[0]?.[0] as number | undefined,
    body: json.mock.calls[0]?.[0] as { message?: string; data?: unknown },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  svc.add.mockResolvedValue({ address: { id: 'a1' }, created: true } as never);
  svc.update.mockResolvedValue({ id: 'a1' } as never);
});

describe('AddressController', () => {
  it('creates an address (201) and reports a duplicate as 200', async () => {
    expect((await call(AddressController.create, { body: VALID })).status).toBe(201);

    svc.add.mockResolvedValue({ address: { id: 'a1' }, created: false } as never);
    const dup = await call(AddressController.create, { body: VALID });
    expect(dup.status).toBe(200);
    expect(dup.body.message).toMatch(/already have/);
  });

  it.each([
    ['no address line', { addressLine1: undefined }],
    ['no recipient', { recipientName: undefined }],
    ['no phone', { phoneNumber: undefined }],
    ['a phone with letters', { phoneNumber: 'call me' }],
    ['an unknown type', { addressType: 'CASTLE' }],
    ['a 5-digit ZIP', { zipCode: '26000' }],
    ['an address line over 300 characters', { addressLine1: 'x'.repeat(301) }],
  ])('rejects %s', async (_label, over) => {
    const { status } = await call(AddressController.create, { body: { ...VALID, ...over } });
    expect(status).toBe(400);
    expect(svc.add).not.toHaveBeenCalled();
  });

  it('accepts the optional parts and turns empty ones into null', async () => {
    await call(AddressController.create, {
      body: { ...VALID, addressType: 'OFFICE', city: 'Baguio City', province: '', zipCode: '2600' },
    });
    expect(svc.add).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        addressType: 'OFFICE',
        city: 'Baguio City',
        province: null,
        zipCode: '2600',
      }),
    );
  });

  it('rejects an empty update', async () => {
    const { status } = await call(AddressController.update, { body: {}, params: { id: 'a1' } });
    expect(status).toBe(400);
  });

  it('updates with only the fields sent', async () => {
    await call(AddressController.update, {
      body: { isDefault: true },
      params: { id: 'a1' },
    });
    expect(svc.update).toHaveBeenCalledWith('user-1', 'a1', { isDefault: true });
  });

  it('needs a signed-in user', async () => {
    const { status } = await call(AddressController.index, { user: null });
    expect(status).toBe(401);
  });

  it('passes service errors (403 / 404) to the error handler', async () => {
    svc.remove.mockRejectedValue({ status: 404, message: 'Address not found' });
    const { next } = await call(AddressController.remove, { params: { id: 'x' } });
    expect(next).toHaveBeenCalledWith({ status: 404, message: 'Address not found' });
  });
});
