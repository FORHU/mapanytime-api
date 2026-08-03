import ShipmentRepository from './shipment.repository';
import { SHIPMENTSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export default class ShipmentService {
  static async createShipment(payload: {
    orderId: string;
    courier: string;
    trackingNumber?: string;
    shippingFee?: number;
    labelUrl?: string;
  }) {
    const order = await prisma.orders.findUnique({
      where: { id: payload.orderId },
    });

    if (!order) {
      throw { status: 404, message: 'Order not found.' };
    }

    const existing = await ShipmentRepository.findByOrderId(payload.orderId);
    if (existing) {
      throw { status: 400, message: 'Shipment record already exists for this order.' };
    }

    return ShipmentRepository.createShipment(payload);
  }

  static async getShipmentByOrderId(orderId: string) {
    const shipment = await ShipmentRepository.findByOrderId(orderId);
    if (!shipment) {
      throw { status: 404, message: 'Shipment record not found for this order.' };
    }
    return shipment;
  }

  static async updateShipmentStatus(
    shipmentId: string,
    payload: {
      status: SHIPMENTSTATUS;
      trackingNumber?: string;
      labelUrl?: string;
    },
  ) {
    const shipment = await ShipmentRepository.findById(shipmentId);
    if (!shipment) {
      throw { status: 404, message: 'Shipment record not found.' };
    }

    return ShipmentRepository.updateStatus(
      shipmentId,
      payload.status,
      payload.trackingNumber,
      payload.labelUrl,
    );
  }
}
