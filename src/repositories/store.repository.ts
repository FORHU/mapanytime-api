import { prisma } from '../utils/prisma';

export default class StoreRepository {
  static async getActiveStoresWithLocations() {
    return prisma.stores.findMany({
      where: { IsActive: true },
      include: { StoreLocations: true },
    });
  }
}