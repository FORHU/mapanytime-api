import PricingRepository, { CreatePricingConfigurationInput } from './pricing.repository';
import PricingEngineService, {
  PricingCalculationInput,
  OrderPricingResult,
} from './pricing-engine.service';

export default class PricingService {
  /**
   * Calculates pricing preview for checkout or cart summary.
   */
  static async calculatePricing(input: PricingCalculationInput): Promise<OrderPricingResult> {
    return PricingEngineService.calculateOrderPricing(input);
  }

  /**
   * Retrieves currently active pricing configuration.
   */
  static async getActivePricing() {
    const config = await PricingRepository.getActiveConfiguration();
    if (!config) {
      return {
        name: 'Default Fallback Pricing',
        status: 'ACTIVE',
        currency: 'PHP',
        defaultSellerCommission: 0.02,
        defaultBuyerPlatformFee: 0.0023,
        defaultGatewayProcessingFee: 0.02,
      };
    }
    return config;
  }

  /**
   * Admin: List all pricing configurations
   */
  static async listPricingConfigurations() {
    return PricingRepository.listConfigurations();
  }

  /**
   * Admin: Create new pricing configuration
   */
  static async createPricingConfiguration(data: CreatePricingConfigurationInput) {
    return PricingRepository.createConfiguration(data);
  }
}
