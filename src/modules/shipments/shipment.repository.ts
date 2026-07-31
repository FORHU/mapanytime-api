import { prisma } from '../../utils/prisma';
import { SHIPMENTSTATUS, Prisma } from '@prisma/client';

export default class ShipmentRepository {
  static async createShipment(data: {
    orderId: string;
    courier: string;
    trackingNumber?: string;
    shippingFee?: number;
    labelUrl?: string;
    status?: SHIPMENTSTATUS;
  }) {
    return prisma.shipments.create({
      data: {
        orderId: data.orderId,
        courier: data.courier,
        trackingNumber: data.trackingNumber ?? null,
        shippingFee: data.shippingFee ?? 0,
        labelUrl: data.labelUrl ?? null,
        status: data.status ?? 'PENDING',
      },
      include: {
        order: {
          include: {
            store: { select: { id: true, storeName: true } },
            buyer: { select: { id: true, displayName: true } },
          },
        },
      },
    });
  }

  static async findByOrderId(orderId: string) {
    return prisma.shipments.findUnique({
      where: { orderId },
      include: {
        order: {
          include: {
            store: { select: { id: true, storeName: true } },
            buyer: { select: { id: true, displayName: true } },
          },
        },
      },
    });
  }

  static async findById(id: string) {
    return prisma.shipments.findUnique({
      where: { id },
      include: {
        order: true,
      },
    });
  }

  static async updateStatus(
    id: string,
    status: SHIPMENTSTATUS,
    trackingNumber?: string,
    labelUrl?: string,
  ) {
    const updateData: Prisma.ShipmentsUpdateInput = {
      status,
      ...(trackingNumber ? { trackingNumber } : {}),
      ...(labelUrl ? { labelUrl } : {}),
      ...(status === 'IN_TRANSIT' && { shippedAt: new Date() }),
      ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
    };

    return prisma.shipments.update({
      where: { id },
      data: updateData,
    });
  }
}
