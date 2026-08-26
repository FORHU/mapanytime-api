import {
  normalizeProductOptions,
  toOptionsCreateInput,
} from '../../src/modules/products/product-options.helper';
import { PRODUCT_LIMITS } from '../../src/constants/product-limits.constant';

describe('normalizeProductOptions — absent / empty input', () => {
  it('treats undefined as no options', () => {
    expect(normalizeProductOptions(undefined)).toEqual([]);
  });

  it('treats an empty array as no options', () => {
    expect(normalizeProductOptions([])).toEqual([]);
  });
});

describe('normalizeProductOptions — whitespace', () => {
  it('collapses internal whitespace runs and trims', () => {
    expect(
      normalizeProductOptions([{ name: '  Sleeve   Length ', values: ['  Long  Sleeve  '] }]),
    ).toEqual([{ name: 'Sleeve Length', values: ['Long Sleeve'] }]);
  });

  it('drops an option whose name is only whitespace', () => {
    expect(normalizeProductOptions([{ name: '   ', values: ['S'] }])).toEqual([]);
  });

  it('drops values that are only whitespace', () => {
    expect(normalizeProductOptions([{ name: 'Size', values: ['S', '   ', 'M'] }])).toEqual([
      { name: 'Size', values: ['S', 'M'] },
    ]);
  });

  it('drops an option whose values are ALL whitespace', () => {
    // Defence in depth. Over HTTP Joi rejects this first with a 400 (it applies
    // .trim() before .min(1)), but callers that bypass the controller — seeders,
    // scripts, internal callers — reach the service directly.
    expect(normalizeProductOptions([{ name: 'Color', values: ['  ', ' '] }])).toEqual([]);
  });
});

describe('normalizeProductOptions — deduplication', () => {
  it('dedupes values case-insensitively, keeping the first casing seen', () => {
    expect(
      normalizeProductOptions([{ name: 'Color', values: ['Red', 'red', 'RED', 'Blue'] }]),
    ).toEqual([{ name: 'Color', values: ['Red', 'Blue'] }]);
  });

  it('dedupes option names case-insensitively', () => {
    const result = normalizeProductOptions([
      { name: 'Size', values: ['S'] },
      { name: 'size', values: ['M'] },
    ]);
    expect(result).toHaveLength(1);
  });

  it('resolves a duplicate option name by FIRST-WINS, not by merging values', () => {
    // Merging would silently produce ["S","M"] — surprising, and inconsistent
    // with how duplicate values are handled.
    expect(
      normalizeProductOptions([
        { name: 'Size', values: ['S'] },
        { name: 'Size', values: ['M'] },
      ]),
    ).toEqual([{ name: 'Size', values: ['S'] }]);
  });

  it('does not let a dropped duplicate consume the option budget', () => {
    const result = normalizeProductOptions([
      { name: 'Size', values: ['S'] },
      { name: 'size', values: ['M'] },
      { name: 'Color', values: ['Red'] },
      { name: 'Material', values: ['Cotton'] },
    ]);
    expect(result.map((o) => o.name)).toEqual(['Size', 'Color', 'Material']);
  });
});

describe('normalizeProductOptions — casing is preserved verbatim', () => {
  it.each(['iPhone', 'XL', '500ml', 'USB-C', 'eXtra'])('stores %s exactly as typed', (value) => {
    expect(normalizeProductOptions([{ name: 'Model', values: [value] }])[0].values).toEqual([
      value,
    ]);
  });
});

describe('normalizeProductOptions — caps', () => {
  it(`keeps at most ${PRODUCT_LIMITS.OPTIONS_MAX} options`, () => {
    const raw = ['Size', 'Color', 'Material', 'Fit', 'Style'].map((name) => ({
      name,
      values: ['x'],
    }));
    expect(normalizeProductOptions(raw)).toHaveLength(PRODUCT_LIMITS.OPTIONS_MAX);
  });

  it(`keeps at most ${PRODUCT_LIMITS.OPTION_VALUES_MAX} values per option`, () => {
    const values = Array.from({ length: 50 }, (_, i) => `v${i}`);
    expect(normalizeProductOptions([{ name: 'Size', values }])[0].values).toHaveLength(
      PRODUCT_LIMITS.OPTION_VALUES_MAX,
    );
  });
});

describe('toOptionsCreateInput', () => {
  it('assigns contiguous positions from the surviving order', () => {
    const normalized = normalizeProductOptions([
      { name: 'Size', values: ['S'] },
      { name: '  ', values: ['ignored'] }, // dropped
      { name: 'Color', values: ['Red'] },
    ]);

    expect(toOptionsCreateInput(normalized)).toEqual([
      { name: 'Size', position: 0, values: { create: [{ value: 'S' }] } },
      // position 1, not 2 — the dropped option must not leave a gap.
      { name: 'Color', position: 1, values: { create: [{ value: 'Red' }] } },
    ]);
  });

  it('produces the exact nested-write shape Prisma expects', () => {
    expect(toOptionsCreateInput([{ name: 'Size', values: ['S', 'M'] }])).toEqual([
      {
        name: 'Size',
        position: 0,
        values: { create: [{ value: 'S' }, { value: 'M' }] },
      },
    ]);
  });
});
