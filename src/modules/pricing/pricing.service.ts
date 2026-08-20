import PricingRepository, {
  CreatePricingComponentInput,
  CreatePricingConfigurationInput,
  UpdatePricingConfigurationInput,
} from './pricing.repository';
import PricingEngineService, {
  PricingCalculationInput,
  OrderPricingResult,
} from './pricing-engine.service';

export interface PricingValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

export interface PricingValidationResult {
  valid: boolean;
  issues: PricingValidationIssue[];
}

/** A rate outside this band is almost certainly a units mistake, not a policy. */
const MAX_PLAUSIBLE_RATE = 0.5; // 50%

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
        paymentFeePayerPolicy: 'BUYER',
        defaultSellerCommission: 0.02,
        // Zero by decision — the old 0.23% was GCash's own rate mislabelled as
        // platform margin, not a fee the platform charges. See FLAGS.md F32.
        defaultBuyerPlatformFee: 0,
        defaultGatewayProcessingFee: 0.02,
        // Surfaced so the admin screen can say plainly that nothing is
        // configured and every order is pricing off understated fallbacks.
        isFallback: true,
      };
    }
    return config;
  }

  static async listPricingConfigurations() {
    return PricingRepository.listConfigurations();
  }

  static async getPricingConfiguration(id: string) {
    const config = await PricingRepository.getConfigurationById(id);
    if (!config) throw { status: 404, message: 'Pricing configuration not found.' };
    return config;
  }

  static async createPricingConfiguration(data: CreatePricingConfigurationInput) {
    // A configuration is always born a draft, whatever the caller asked for.
    // Honouring a requested ACTIVE would skip validation entirely and reprice
    // every order the moment it saved. `activateConfiguration` is the only way
    // to go live, and it validates first.
    return PricingRepository.createConfiguration({ ...data, status: 'DRAFT' });
  }

  static async updatePricingConfiguration(id: string, data: UpdatePricingConfigurationInput) {
    await this.getPricingConfiguration(id);
    return PricingRepository.updateConfiguration(id, data);
  }

  static async addComponent(pricingId: string, component: CreatePricingComponentInput) {
    await this.getPricingConfiguration(pricingId);
    return PricingRepository.addComponent(pricingId, component);
  }

  static async updateComponent(id: string, component: Partial<CreatePricingComponentInput>) {
    return PricingRepository.updateComponent(id, component);
  }

  static async deleteComponent(id: string) {
    return PricingRepository.deleteComponent(id);
  }

  /**
   * Check a configuration against the things that would silently cost money if
   * they were wrong, before it is allowed anywhere near a live order.
   *
   * Errors block activation. Warnings do not — an admin may legitimately want a
   * configuration that leans on a fallback — but they are surfaced so the
   * choice is deliberate rather than an oversight.
   */
  static async validateConfiguration(id: string): Promise<PricingValidationResult> {
    const config = await this.getPricingConfiguration(id);
    const issues: PricingValidationIssue[] = [];

    const active = config.components.filter((c) => c.isActive);

    if (active.length === 0) {
      issues.push({
        severity: 'ERROR',
        code: 'NO_COMPONENTS',
        message:
          'This configuration has no active components, so every order would price off the ' +
          'built-in fallback rates, which understate every real gateway rate.',
      });
    }

    if (!active.some((c) => c.type === 'SELLER_MARKETPLACE_FEE')) {
      issues.push({
        severity: 'WARNING',
        code: 'NO_COMMISSION_COMPONENT',
        message:
          'No SELLER_MARKETPLACE_FEE component. Commission will fall back to the built-in ' +
          '2.00%, which is correct today but will not track a change made here.',
      });
    }

    if (!active.some((c) => c.type === 'PAYMENT_PROCESSING_FEE')) {
      issues.push({
        severity: 'ERROR',
        code: 'NO_GATEWAY_COMPONENT',
        message:
          'No PAYMENT_PROCESSING_FEE component. Every method would price off the flat 2.00% ' +
          'fallback and the platform would absorb the difference on cards.',
      });
    }

    for (const c of active) {
      const rate = c.ratePercentage ? Number(c.ratePercentage) : 0;
      const fixed = c.fixedAmount ? Number(c.fixedAmount) : 0;

      if (rate < 0 || fixed < 0) {
        issues.push({
          severity: 'ERROR',
          code: 'NEGATIVE_AMOUNT',
          message: `Component ${c.id} (${c.type}) has a negative rate or fixed amount.`,
        });
      }

      // 2 instead of 0.02 is the classic percent-versus-fraction slip, and it
      // would charge a buyer 200% of their basket.
      if (rate > MAX_PLAUSIBLE_RATE) {
        issues.push({
          severity: 'ERROR',
          code: 'IMPLAUSIBLE_RATE',
          message:
            `Component ${c.id} (${c.type}) has a rate of ${rate}, i.e. ${(rate * 100).toFixed(2)}%. ` +
            'Rates are fractions — 2.00% is 0.02, not 2.',
        });
      }

      if (rate === 0 && fixed === 0) {
        issues.push({
          severity: 'WARNING',
          code: 'ZERO_COMPONENT',
          message: `Component ${c.id} (${c.type}) charges nothing. Deactivate it instead if that is intended.`,
        });
      }

      if (c.minFee && c.maxFee && Number(c.minFee) > Number(c.maxFee)) {
        issues.push({
          severity: 'ERROR',
          code: 'MIN_ABOVE_MAX',
          message: `Component ${c.id} (${c.type}) has a minimum fee above its maximum fee.`,
        });
      }
    }

    if (config.effectiveUntil && config.effectiveUntil <= config.effectiveFrom) {
      issues.push({
        severity: 'ERROR',
        code: 'EMPTY_EFFECTIVE_WINDOW',
        message: 'The effective window ends before it begins, so this configuration never applies.',
      });
    }

    if (config.effectiveUntil && config.effectiveUntil <= new Date()) {
      issues.push({
        severity: 'ERROR',
        code: 'ALREADY_EXPIRED',
        message: 'This configuration has already expired and would never match a live order.',
      });
    }

    return { valid: !issues.some((i) => i.severity === 'ERROR'), issues };
  }

  /**
   * Promote a configuration to live, refusing anything that fails validation.
   *
   * Activation is the one irreversible-in-effect action here — the next order
   * prices off whatever this leaves behind — so the invalid cases are blocked
   * rather than merely reported.
   */
  static async activateConfiguration(id: string) {
    const validation = await this.validateConfiguration(id);

    if (!validation.valid) {
      throw {
        status: 422,
        message: 'This pricing configuration cannot be activated until its errors are resolved.',
        errors: validation.issues.filter((i) => i.severity === 'ERROR'),
      };
    }

    const activated = await PricingRepository.activateConfiguration(id);
    return { ...activated, warnings: validation.issues.filter((i) => i.severity === 'WARNING') };
  }

  static async archiveConfiguration(id: string) {
    const config = await this.getPricingConfiguration(id);

    // Archiving the live configuration with nothing to replace it drops every
    // order back onto the understated fallback rates.
    if (config.status === 'ACTIVE') {
      throw {
        status: 409,
        message:
          'This is the active configuration. Activate its replacement instead — doing so ' +
          'archives this one in the same transaction.',
      };
    }

    return PricingRepository.archiveConfiguration(id);
  }
}
