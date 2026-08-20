import PricingService from '../../src/modules/pricing/pricing.service';
import PricingRepository from '../../src/modules/pricing/pricing.repository';

jest.mock('../../src/modules/pricing/pricing.repository');

const mockRepo = PricingRepository as jest.Mocked<typeof PricingRepository>;

const VALID_COMPONENTS = [
  { id: 'c1', type: 'PAYMENT_PROCESSING_FEE', ratePercentage: 0.0223, isActive: true },
  { id: 'c2', type: 'SELLER_MARKETPLACE_FEE', ratePercentage: 0.02, isActive: true },
];

function givenConfiguration(overrides: Record<string, unknown> = {}) {
  mockRepo.getConfigurationById.mockResolvedValue({
    id: 'cfg-1',
    name: 'Standard Marketplace Pricing v1',
    status: 'DRAFT',
    effectiveFrom: new Date('2026-01-01'),
    effectiveUntil: null,
    components: VALID_COMPONENTS,
    ...overrides,
  } as never);
}

/**
 * `POST /pricing/configurations` was the only write endpoint that existed, so
 * a configuration could be created but never edited or made live — the admin
 * screen's Save & Sync and Add Component were disabled for want of a route.
 * See FLAGS.md F21 / FEE-7.
 */
describe('PricingService.validateConfiguration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes a configuration that prices every axis', async () => {
    givenConfiguration();

    const result = await PricingService.validateConfiguration('cfg-1');

    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'ERROR')).toHaveLength(0);
  });

  it('rejects a configuration with no components at all', async () => {
    givenConfiguration({ components: [] });

    const result = await PricingService.validateConfiguration('cfg-1');

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('NO_COMPONENTS');
  });

  // Without one, every method prices off the flat 2% fallback and cards lose
  // money on every sale.
  it('rejects a configuration with no gateway component', async () => {
    givenConfiguration({ components: [VALID_COMPONENTS[1]] });

    const result = await PricingService.validateConfiguration('cfg-1');

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('NO_GATEWAY_COMPONENT');
  });

  // 2 instead of 0.02 would charge a buyer 200% of their basket.
  it('catches a rate entered as a percent rather than a fraction', async () => {
    givenConfiguration({
      components: [{ id: 'c1', type: 'PAYMENT_PROCESSING_FEE', ratePercentage: 2, isActive: true }],
    });

    const result = await PricingService.validateConfiguration('cfg-1');

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('IMPLAUSIBLE_RATE');
  });

  it('catches a minimum fee above its maximum', async () => {
    givenConfiguration({
      components: [{ ...VALID_COMPONENTS[0], minFee: 50, maxFee: 10 }, VALID_COMPONENTS[1]],
    });

    const result = await PricingService.validateConfiguration('cfg-1');

    expect(result.issues.map((i) => i.code)).toContain('MIN_ABOVE_MAX');
  });

  it('catches an effective window that has already closed', async () => {
    givenConfiguration({ effectiveUntil: new Date('2020-01-01') });

    const result = await PricingService.validateConfiguration('cfg-1');

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('ALREADY_EXPIRED');
  });

  // A missing commission component is survivable — the fallback is the same
  // 2% — so it must not block an otherwise sound configuration.
  it('warns without blocking when commission leans on the fallback', async () => {
    givenConfiguration({ components: [VALID_COMPONENTS[0]] });

    const result = await PricingService.validateConfiguration('cfg-1');

    expect(result.valid).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain('NO_COMMISSION_COMPONENT');
  });
});

describe('PricingService.activateConfiguration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses to make an invalid configuration live', async () => {
    givenConfiguration({ components: [] });

    await expect(PricingService.activateConfiguration('cfg-1')).rejects.toMatchObject({
      status: 422,
    });
    expect(mockRepo.activateConfiguration).not.toHaveBeenCalled();
  });

  it('activates a valid configuration and reports its warnings', async () => {
    givenConfiguration({ components: [VALID_COMPONENTS[0]] });
    mockRepo.activateConfiguration.mockResolvedValue({ id: 'cfg-1', status: 'ACTIVE' } as never);

    const result = await PricingService.activateConfiguration('cfg-1');

    expect(mockRepo.activateConfiguration).toHaveBeenCalledWith('cfg-1');
    expect(result.warnings.map((w) => w.code)).toContain('NO_COMMISSION_COMPONENT');
  });
});

describe('PricingService.createPricingConfiguration', () => {
  beforeEach(() => jest.clearAllMocks());

  // Creating one straight to ACTIVE would skip validation and reprice every
  // order the moment it saved.
  it('creates a configuration as a draft, never live', async () => {
    mockRepo.createConfiguration.mockResolvedValue({ id: 'cfg-2' } as never);

    await PricingService.createPricingConfiguration({
      name: 'v2',
      status: 'ACTIVE',
    } as never);

    expect(mockRepo.createConfiguration.mock.calls[0][0].status).toBe('DRAFT');
  });
});

describe('PricingService.archiveConfiguration', () => {
  beforeEach(() => jest.clearAllMocks());

  // Archiving the live one with no replacement drops every order back onto the
  // understated fallback rates.
  it('refuses to archive the active configuration', async () => {
    givenConfiguration({ status: 'ACTIVE' });

    await expect(PricingService.archiveConfiguration('cfg-1')).rejects.toMatchObject({
      status: 409,
    });
  });
});
