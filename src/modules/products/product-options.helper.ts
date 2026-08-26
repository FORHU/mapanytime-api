import { PRODUCT_LIMITS } from '../../constants/product-limits.constant';

/**
 * Normalises the option tier of a product ("Size: S, M, L").
 *
 * This is the ENFORCING copy. The web mirror at
 * mapanytime-market-web/src/features/seller-catalog/lib/variant-options.ts is
 * UX only — it keeps the form honest, but every rule here has to hold
 * regardless of what the client sent.
 *
 * The DB uniques on ProductOptions(productId, name) and
 * ProductOptionValues(optionId, value) are a backstop, not the defence:
 * Postgres uniques are case- and whitespace-sensitive, so "Size", "size" and
 * "Size " would all slip past them. If this function is ever bypassed, those
 * indexes turn a silent duplicate into a P2002 → 500.
 */

export interface RawProductOption {
  name: string;
  values: string[];
}

/** Collapses internal whitespace runs and trims. `" Sleeve  Length "` → `"Sleeve Length"`. */
function collapse(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Casing is preserved rather than title-cased on purpose: "iPhone", "XL",
 * "500ml" and "USB-C" all break under any naive casing rule. Comparison is
 * case-insensitive; storage is verbatim, exactly as the seller typed it.
 */
export function normalizeProductOptions(raw: RawProductOption[] | undefined): RawProductOption[] {
  if (!raw || raw.length === 0) return [];

  const seenNames = new Set<string>();
  const result: RawProductOption[] = [];

  for (const option of raw) {
    const name = collapse(option.name ?? '');
    if (!name) continue;

    const nameKey = name.toLowerCase();
    // First-wins, NOT merge. Merging two "Size" options' value lists would be
    // surprising, and first-wins matches how duplicate values are handled below.
    if (seenNames.has(nameKey)) continue;

    const seenValues = new Set<string>();
    const values: string[] = [];

    for (const rawValue of option.values ?? []) {
      const value = collapse(rawValue ?? '');
      if (!value) continue;

      const valueKey = value.toLowerCase();
      if (seenValues.has(valueKey)) continue;

      seenValues.add(valueKey);
      values.push(value);

      if (values.length >= PRODUCT_LIMITS.OPTION_VALUES_MAX) break;
    }

    // An option with no surviving values is dropped entirely — the DB permits
    // one, but it renders as a labelled row with nothing under it.
    //
    // Defence in depth rather than the only guard: Joi applies .trim() before
    // .min(1), so a blank value is already rejected with a 400 at the
    // controller (verified: `"options[0].values[0]" is not allowed to be
    // empty`). This still matters for callers that bypass the controller —
    // seeders, scripts, and any future internal caller.
    if (values.length === 0) continue;

    seenNames.add(nameKey);
    result.push({ name, values });

    if (result.length >= PRODUCT_LIMITS.OPTIONS_MAX) break;
  }

  return result;
}

/**
 * Nested-write shape for both create and update. Positions are assigned from
 * the surviving order so they stay contiguous even after drops.
 */
export function toOptionsCreateInput(options: RawProductOption[]) {
  return options.map((option, index) => ({
    name: option.name,
    position: index,
    values: { create: option.values.map((value) => ({ value })) },
  }));
}
