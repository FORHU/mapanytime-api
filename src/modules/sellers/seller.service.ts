import SellerRepository from './seller.repository';
import { buildPage } from '../../helpers/pagination.helper';

export default class SellerService {
  static async listPendingSellers(page: number, limit: number, skip: number) {
    const { sellers, total } = await SellerRepository.getPendingSellers(limit, skip);

    const items = sellers.map((seller) => ({
      id: seller.id,
      userId: seller.userId,
      firstName: seller.users.firstName,
      lastName: seller.users.lastName,
      email: seller.users.email,
      phoneNumber: seller.users.phoneNumber,
      applicationStatus: seller.applicationStatus,
      storeCount: seller._count.stores,
      // The count of verification records, matching what the detail view lists.
      verificationCount: seller._count.documentVerifications,
      createdAt: seller.createdAt,
    }));

    return buildPage(items, total, { page, limit });
  }

  static async getSellerDetail(sellerId: string) {
    const seller = await SellerRepository.getSellerById(sellerId);

    if (!seller) {
      throw { status: 404, message: 'Seller not found.' };
    }

    return {
      id: seller.id,
      userId: seller.userId,
      firstName: seller.users.firstName,
      lastName: seller.users.lastName,
      email: seller.users.email,
      phoneNumber: seller.users.phoneNumber,
      applicationStatus: seller.applicationStatus,
      rejectionReason: seller.rejectionReason,
      createdAt: seller.createdAt,
      reviewedAt: seller.reviewedAt,
      reviewedBy: seller.reviewedBy
        ? {
            id: seller.reviewedBy.id,
            email: seller.reviewedBy.email,
            name: `${seller.reviewedBy.firstName} ${seller.reviewedBy.lastName}`,
          }
        : null,
      stores: seller.stores,
      documentVerifications: seller.documentVerifications.map((dv) => ({
        id: dv.id,
        status: dv.verificationStatus,
        documents: dv.documents.map((doc) => ({
          id: doc.id,
          type: doc.documentType,
        })),
      })),
    };
  }

  /**
   * Approve or reject a pending seller.
   *
   * The seller is read first so the caller gets a real 404 and so the response
   * can carry the applicant's name — but the status check that matters lives in
   * the repository's WHERE clause, so a concurrent decision loses with a 409
   * rather than overwriting the winner.
   */
  private static async review(
    sellerId: string,
    decision: 'APPROVED' | 'REJECTED',
    adminId: string,
    rejectionReason: string | null,
  ) {
    const seller = await SellerRepository.getSellerById(sellerId);

    if (!seller) {
      throw { status: 404, message: 'Seller not found.' };
    }

    const changed = await SellerRepository.recordDecision(
      sellerId,
      decision,
      adminId,
      rejectionReason,
    );

    if (changed === 0) {
      throw {
        status: 409,
        message: `This seller has already been reviewed (status: ${seller.applicationStatus}).`,
      };
    }

    return {
      id: seller.id,
      status: decision,
      email: seller.users.email,
      name: `${seller.users.firstName} ${seller.users.lastName}`,
    };
  }

  static async approveSeller(sellerId: string, adminId: string) {
    return SellerService.review(sellerId, 'APPROVED', adminId, null);
  }

  static async rejectSeller(sellerId: string, reason: string, adminId: string) {
    // Length bounds are enforced by the controller's Joi schema.
    return SellerService.review(sellerId, 'REJECTED', adminId, reason);
  }
}
