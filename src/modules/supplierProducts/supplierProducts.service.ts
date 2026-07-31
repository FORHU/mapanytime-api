import SupplierProductsRepository from './supplierProducts.repository';

export class SupplierProductsService {
  static async createSupplierProduct(payload: {
    sellerId: string;
    productId: string;
    supplierSku?: string;
    costPrice?: number;
    minimumOrderQty?: number;
    supplyLeadDays?: number;
  }) {
    return SupplierProductsRepository.create({
      seller: { connect: { id: payload.sellerId } },
      product: { connect: { id: payload.productId } },
      supplierSku: payload.supplierSku,
      costPrice: payload.costPrice,
      minimumOrderQty: payload.minimumOrderQty ?? 1,
      supplyLeadDays: payload.supplyLeadDays ?? 1,
    });
  }

  static async getSupplierProductsBySeller(sellerId: string) {
    return SupplierProductsRepository.findBySellerId(sellerId);
  }

  static async getSupplierProductsByProduct(productId: string) {
    return SupplierProductsRepository.findByProductId(productId);
  }

  static async updateSupplierProduct(
    id: string,
    payload: {
      supplierSku?: string;
      costPrice?: number;
      minimumOrderQty?: number;
      supplyLeadDays?: number;
      isAvailable?: boolean;
    },
  ) {
    return SupplierProductsRepository.update(id, payload);
  }

  static async deleteSupplierProduct(id: string) {
    return SupplierProductsRepository.delete(id);
  }
}

export default SupplierProductsService;
