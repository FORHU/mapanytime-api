/**
 * Allowed product tags — single source of truth.
 * These are the enum names; stored in the database as-is.
 * When converting to Prisma enum type, the names will match exactly.
 */
export const ALLOWED_PRODUCT_TAGS = [
  "NEW_ARRIVAL",
  "POPULAR",
  "LIMITED_EDITION",
  "BEST_SELLER",
  "TRENDING",
  "ORGANIC",
  "SEASONAL",
  "VEGAN",
  "USED",
] as const;

export type AllowedProductTag = (typeof ALLOWED_PRODUCT_TAGS)[number];

/**
 * Map from enum names to display strings.
 * Used by the API to return readable labels to clients.
 */
export const TAG_DISPLAY_NAMES: Record<AllowedProductTag, string> = {
  NEW_ARRIVAL: "New Arrival",
  POPULAR: "Popular",
  LIMITED_EDITION: "Limited Edition",
  BEST_SELLER: "Best Seller",
  TRENDING: "Trending",
  ORGANIC: "Organic",
  SEASONAL: "Seasonal",
  VEGAN: "Vegan",
  USED: "Used",
};
