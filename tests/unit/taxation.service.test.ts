import TaxationService from '../../src/services/taxation.service';
import TaxationRepository from '../../src/repositories/taxation.repository';

jest.mock('../../src/repositories/taxation.repository');

describe('TaxationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateTax', () => {
    it('calculates default 12% tax correctly', () => {
      const tax = TaxationService.calculateTax(100);
      expect(tax).toBe(12);
    });

    it('returns 0 for negative or zero amounts', () => {
      expect(TaxationService.calculateTax(0)).toBe(0);
      expect(TaxationService.calculateTax(-50)).toBe(0);
    });

    it('rounds to 2 decimal places', () => {
      const tax = TaxationService.calculateTax(99.99, 0.12);
      expect(tax).toBe(12.0);
    });
  });

  describe('calculateCommission', () => {
    it('uses fallback 5% when no custom rule exists', async () => {
      (TaxationRepository.getCommissionRuleForCategory as jest.Mock).mockResolvedValue(null);

      const commission = await TaxationService.calculateCommission(1000);
      expect(commission).toBe(50);
    });

    it('applies custom category commission rate and fixed fee', async () => {
      (TaxationRepository.getCommissionRuleForCategory as jest.Mock).mockResolvedValue({
        commissionRate: 0.1,
        fixedFee: 15,
      });

      const commission = await TaxationService.calculateCommission(1000, 'cat-1');
      expect(commission).toBe(115); // 10% of 1000 (100) + 15 fixed fee = 115
    });
  });

  describe('calculateOrderFinancials', () => {
    it('computes full financial breakdown with tax and commission', async () => {
      (TaxationRepository.getCommissionRuleForCategory as jest.Mock).mockResolvedValue({
        commissionRate: 0.05,
        fixedFee: 0,
      });

      const financials = await TaxationService.calculateOrderFinancials({
        subtotalAmount: 1000,
        shippingAmount: 50,
        discountAmount: 100,
      });

      expect(financials.subtotalAmount).toBe(1000);
      expect(financials.shippingAmount).toBe(50);
      expect(financials.discountAmount).toBe(100);
      expect(financials.taxAmount).toBe(120); // 12% of 1000
      expect(financials.marketplaceFeeAmount).toBe(50); // 5% of 1000
      expect(financials.totalAmount).toBe(1070); // 1000 + 50 + 120 - 100
      expect(financials.sellerNetAmount).toBe(900); // 1000 + 50 - 100 - 50
    });
  });
});
