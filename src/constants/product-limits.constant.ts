/**
 * Bounds for seller-authored product fields — the single server-side source of
 * truth. These were previously enforced only in the web forms, and the two
 * forms disagreed: the create form capped price at 999,999,999.99 while the
 * edit form capped it at 999,999.99, so a product created through one could
 * not be saved through the other.
 *
 * `Products.name` / `brand` / `description` are unbounded `text` columns, so
 * these are storefront limits rather than schema ones. The price ceiling is a
 * storefront limit too — it sits well under MAX_MONEY (the Decimal(12, 2)
 * limit in money.helper.ts), which is what the column can physically hold.
 *
 * Keep in sync with mapanytime-market-web/src/shared/constants/product-limits.constant.ts.
 */
export const PRODUCT_LIMITS = {
  NAME_MAX: 200,
  BRAND_MAX: 60,
  DESCRIPTION_MAX: 600,
  /** Highest price a listing can be set to. */
  PRICE_MAX: 999_999_999.99,
  /** `Inventory.quantityOnHand` is int4; this stays well inside it. */
  STOCK_MAX: 999_999_999,

  // ── Option tier (Size: S/M/L, Color: Red/Blue) ──────────────────────────
  // We do not generate combinations — the product keeps one price and one
  // stock number — so these are UX bounds rather than a combinatorial guard.
  /** Distinct option names per product, e.g. Size + Color + Material. */
  OPTIONS_MAX: 3,
  OPTION_NAME_MAX: 40,
  /** Choices within one option, e.g. how many sizes. */
  OPTION_VALUES_MAX: 20,
  OPTION_VALUE_MAX: 40,
} as const;
