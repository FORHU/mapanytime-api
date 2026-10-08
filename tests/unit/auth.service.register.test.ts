import AuthSvc from '../../src/modules/auth/auth.service';
import AuthRepo from '../../src/modules/auth/auth.repository';
import S3Util from '../../src/utils/s3.util';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/auth/auth.repository');
jest.mock('../../src/utils/s3.util');
jest.mock('../../src/utils/cache.util', () => ({
  __esModule: true,
  default: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
}));
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/utils/prisma', () => ({ prisma: { $transaction: jest.fn() } }));

const mockRepo = AuthRepo as jest.Mocked<typeof AuthRepo>;
const mockS3 = S3Util as jest.Mocked<typeof S3Util>;
const mockTransaction = prisma.$transaction as unknown as jest.Mock;

/** The `tx` client handed to the transaction callback. */
const tx = {
  users: { create: jest.fn() },
  buyers: { create: jest.fn() },
  buyerAddresses: {
    create: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  files: { create: jest.fn() },
  buyerIdVerifications: { create: jest.fn() },
};

const BASE = {
  email: 'juan@example.com',
  password: 'correct-horse',
  roleName: 'BUYER',
  firstName: 'Juan',
  middleName: 'Santos',
  lastName: 'Dela Cruz',
};

const WITH_ID = {
  ...BASE,
  phoneNumber: '+639171234567',
  dateOfBirth: new Date('1994-03-15'),
  sex: 'MALE' as const,
  validId: {
    idType: 'PHILSYS' as const,
    idNumber: '1234-5678-9012-3456',
    address: '123 Session Rd, Brgy. Session Road, Baguio City, Benguet',
    photo: { buffer: Buffer.from('jpeg'), mimeType: 'image/jpeg', size: 4, originalName: 'id.jpg' },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.findUserByEmail.mockResolvedValue(null as never);
  mockS3.putObject.mockResolvedValue();
  mockS3.deleteObject.mockResolvedValue();
  mockTransaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  tx.users.create.mockResolvedValue({ id: 'user-1' });
  tx.buyers.create.mockResolvedValue({ id: 'buyer-1' });
  tx.files.create.mockResolvedValue({ id: 'file-1' });
  // A brand-new buyer has no addresses yet.
  tx.buyerAddresses.findFirst.mockResolvedValue(null);
  tx.buyerAddresses.count.mockResolvedValue(0);
  tx.buyerAddresses.create.mockResolvedValue({ id: 'addr-1' });
});

describe('AuthSvc.register — buyer valid ID', () => {
  it('stores the photo privately and records a pending ID check', async () => {
    await AuthSvc.register(WITH_ID);

    expect(mockS3.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^buyer-ids\/[0-9a-f]{32}\.jpg$/),
      WITH_ID.validId.photo.buffer,
      'image/jpeg',
    );
    const key = mockS3.putObject.mock.calls[0][0];

    expect(tx.users.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dateOfBirth: WITH_ID.dateOfBirth,
        sex: 'MALE',
        phoneNumber: '+639171234567',
      }),
    });
    expect(tx.files.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        path: key,
        mimeType: 'image/jpeg',
        size: 4,
        uploadedById: 'user-1',
      }),
    });
    expect(tx.buyerIdVerifications.create).toHaveBeenCalledWith({
      data: {
        buyerId: 'buyer-1',
        idType: 'PHILSYS',
        idNumber: '1234-5678-9012-3456',
        address: '123 Session Rd, Brgy. Session Road, Baguio City, Benguet',
        fileId: 'file-1',
      },
    });
  });

  it("saves the sign-up address as the buyer's default home address", async () => {
    await AuthSvc.register(WITH_ID);

    expect(tx.buyerAddresses.create).toHaveBeenCalledWith({
      data: {
        buyerId: 'buyer-1',
        addressType: 'HOME',
        recipientName: 'Juan Santos Dela Cruz',
        phoneNumber: '+639171234567',
        addressLine1: '123 Session Rd, Brgy. Session Road, Baguio City, Benguet',
        addressLine2: null,
        barangay: null,
        city: null,
        province: null,
        zipCode: null,
        country: 'Philippines',
        isDefault: true,
      },
    });
  });

  it('deletes the uploaded photo when the transaction fails', async () => {
    tx.buyerIdVerifications.create.mockRejectedValue(new Error('db down'));

    await expect(AuthSvc.register(WITH_ID)).rejects.toThrow('db down');

    expect(mockS3.deleteObject).toHaveBeenCalledWith(mockS3.putObject.mock.calls[0][0]);
  });

  it('does not upload anything when the email is already taken', async () => {
    mockRepo.findUserByEmail.mockResolvedValue({ id: 'someone' } as never);

    await expect(AuthSvc.register(WITH_ID)).rejects.toMatchObject({ status: 400 });

    expect(mockS3.putObject).not.toHaveBeenCalled();
  });

  it('creates no ID check for a plain sign-up', async () => {
    await AuthSvc.register(BASE);

    expect(mockS3.putObject).not.toHaveBeenCalled();
    expect(tx.buyerAddresses.create).not.toHaveBeenCalled();
    expect(tx.files.create).not.toHaveBeenCalled();
    expect(tx.buyerIdVerifications.create).not.toHaveBeenCalled();
    expect(tx.buyers.create).toHaveBeenCalled();
  });
});
