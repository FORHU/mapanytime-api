import { Request, Response } from 'express';
import AuthController from '../../src/modules/auth/auth.controller';
import AuthSvc from '../../src/modules/auth/auth.service';

jest.mock('../../src/modules/auth/auth.service');
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const mockSvc = AuthSvc as jest.Mocked<typeof AuthSvc>;

const BASE = {
  email: 'juan@example.com',
  password: 'correct-horse',
  roleName: 'BUYER',
  firstName: 'Juan',
  lastName: 'Dela Cruz',
};

/** The multipart fields the app sends with a valid ID photo. */
const WITH_ID = {
  ...BASE,
  phoneNumber: '+639171234567',
  dateOfBirth: '1994-03-15',
  sex: 'MALE',
  validIdType: 'PHILSYS',
  validIdNumber: '1234-5678-9012-3456',
  address: '123 Session Rd, Brgy. Session Road, Baguio City, Benguet',
};

const PHOTO = {
  buffer: Buffer.from('jpeg-bytes'),
  mimetype: 'image/jpeg',
  size: 10,
  originalname: 'id.jpg',
} as Express.Multer.File;

const post = async (body: unknown, file?: Express.Multer.File) => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })), json } as unknown as Response;
  const next = jest.fn();

  await AuthController.register({ body, file } as Request, res, next);

  return {
    next,
    status: (res.status as jest.Mock).mock.calls[0]?.[0] as number | undefined,
    body: json.mock.calls[0]?.[0] as { message?: string },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSvc.register.mockResolvedValue(null);
});

describe('AuthController.register — buyer valid ID', () => {
  it('still accepts the plain JSON sign-up the web sends', async () => {
    const { status } = await post(BASE);
    expect(status).toBe(201);
    expect(mockSvc.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: BASE.email, validId: undefined }),
    );
  });

  it('passes the ID photo, details and address through to the service', async () => {
    const { status } = await post(WITH_ID, PHOTO);
    expect(status).toBe(201);
    const arg = mockSvc.register.mock.calls[0][0];
    expect(arg.dateOfBirth).toEqual(new Date('1994-03-15'));
    expect(arg.sex).toBe('MALE');
    expect(arg.validId).toEqual({
      idType: 'PHILSYS',
      idNumber: '1234-5678-9012-3456',
      address: '123 Session Rd, Brgy. Session Road, Baguio City, Benguet',
      photo: { buffer: PHOTO.buffer, mimeType: 'image/jpeg', size: 10, originalName: 'id.jpg' },
    });
  });

  it.each([
    ['a future date of birth', { dateOfBirth: '2999-01-01' }],
    ['an unknown sex', { sex: 'OTHER' }],
    ['an unknown ID type', { validIdType: 'LIBRARY_CARD' }],
    ['an ID type without its number', { validIdNumber: undefined }],
    ['an ID without an address', { address: undefined }],
    ['an empty address', { address: '' }],
    ['an address over 300 characters', { address: 'x'.repeat(301) }],
  ])('rejects %s', async (_label, over) => {
    const { status } = await post({ ...WITH_ID, ...over }, PHOTO);
    expect(status).toBe(400);
    expect(mockSvc.register).not.toHaveBeenCalled();
  });

  it('requires the ID type and number when a photo is attached', async () => {
    const { validIdType: _t, validIdNumber: _n, address: _a, ...noId } = WITH_ID;
    const { status, body } = await post(noId, PHOTO);
    expect(status).toBe(400);
    expect(body.message).toMatch(/validIdType/);
  });

  it('requires a phone number with the photo (it goes on the saved address)', async () => {
    const { phoneNumber: _p, ...noPhone } = WITH_ID;
    const { status, body } = await post(noPhone, PHOTO);
    expect(status).toBe(400);
    expect(body.message).toMatch(/phoneNumber/);
    expect(mockSvc.register).not.toHaveBeenCalled();
  });

  it('requires the photo when ID details are sent', async () => {
    const { status, body } = await post(WITH_ID);
    expect(status).toBe(400);
    expect(body.message).toMatch(/validId photo is required/);
  });

  it('rejects a PDF or an oversized photo', async () => {
    expect((await post(WITH_ID, { ...PHOTO, mimetype: 'application/pdf' })).status).toBe(400);
    expect((await post(WITH_ID, { ...PHOTO, size: 11 * 1024 * 1024 })).status).toBe(400);
    expect(mockSvc.register).not.toHaveBeenCalled();
  });

  it('only accepts an ID on a buyer sign-up', async () => {
    const { status } = await post({ ...WITH_ID, roleName: 'SELLER' }, PHOTO);
    expect(status).toBe(400);
  });
});
