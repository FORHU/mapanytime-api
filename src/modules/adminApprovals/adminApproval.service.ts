import { PROPERTYSTATUS, STOREAPPROVALSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export type ApprovalStatus = 'PENDING' | 'ACTIVE' | 'REJECTED';

export default class AdminApprovalService {
  static async listApprovals() {
    const [stores, properties] = await Promise.all([
      prisma.stores.findMany({
        where: { deletedAt: null },
        include: {
          seller: { include: { users: true } },
          storeLocations: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.propertiesProducts.findMany({
        include: {
          store: {
            include: {
              seller: { include: { users: true } },
            },
          },
          propertyFiles: {
            include: {
              file: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return [
      ...stores.map((store) => ({
        id: store.id,
        entityType: 'STORE' as const,
        name: store.storeName,
        owner: `${store.seller.users.firstName ?? ''} ${store.seller.users.lastName ?? ''}`.trim(),
        email: store.seller.users.email,
        address: store.storeLocations?.currentAddress ?? '',
        city: store.storeLocations?.city ?? null,
        province: store.storeLocations?.province ?? null,
        propertyType: null,
        status: store.approvalStatus as ApprovalStatus,
        rejectionReason: store.rejectionReason,
        createdAt: store.createdAt,
      })),
      ...properties.map((property) => ({
        id: property.id,
        entityType: 'PROPERTY' as const,
        name: property.propertyType === 'HOUSE_LOT' ? 'House & Lot' : 'Raw Land',
        owner: property.legalName,
        email: property.store.seller.users.email,
        address: property.address,
        city: null,
        province: null,
        propertyType: property.propertyType,
        status:
          property.status === PROPERTYSTATUS.ACTIVE
            ? ('ACTIVE' as const)
            : property.status === PROPERTYSTATUS.REJECTED
              ? ('REJECTED' as const)
              : ('PENDING' as const),
        rejectionReason: property.rejectionReason,
        createdAt: property.createdAt,
      })),
    ];
  }

  static async approveProperty(propertyId: string, adminId: string) {
    const property = await prisma.propertiesProducts.findUnique({ where: { id: propertyId } });
    if (!property) throw { status: 404, message: 'Property not found.' };

    return prisma.propertiesProducts.update({
      where: { id: propertyId },
      data: {
        status: PROPERTYSTATUS.ACTIVE,
        rejectionReason: null,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });
  }

  static async rejectProperty(propertyId: string, adminId: string, reason: string) {
    const property = await prisma.propertiesProducts.findUnique({ where: { id: propertyId } });
    if (!property) throw { status: 404, message: 'Property not found.' };

    return prisma.propertiesProducts.update({
      where: { id: propertyId },
      data: {
        status: PROPERTYSTATUS.REJECTED,
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });
  }

  static async approveStore(storeId: string, adminId: string) {
    const store = await prisma.stores.findUnique({
      where: { id: storeId },
      include: { documentVerifications: true },
    });
    if (!store) throw { status: 404, message: 'Store not found.' };

    return prisma.$transaction(async (tx) => {
      const updated = await tx.stores.update({
        where: { id: storeId },
        data: {
          isActive: true,
          approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
          rejectionReason: null,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
      });

      await tx.documentVerifications.updateMany({
        where: { storeId },
        data: {
          verificationStatus: 'APPROVED',
          verifiedById: adminId,
        },
      });

      return updated;
    });
  }

  static async rejectStore(storeId: string, adminId: string, reason: string) {
    const store = await prisma.stores.findUnique({ where: { id: storeId } });
    if (!store) throw { status: 404, message: 'Store not found.' };

    return prisma.$transaction(async (tx) => {
      const updated = await tx.stores.update({
        where: { id: storeId },
        data: {
          isActive: false,
          approvalStatus: STOREAPPROVALSTATUS.REJECTED,
          rejectionReason: reason,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
      });

      await tx.documentVerifications.updateMany({
        where: { storeId },
        data: {
          verificationStatus: 'REJECTED',
          verifiedById: adminId,
        },
      });

      return updated;
    });
  }
}