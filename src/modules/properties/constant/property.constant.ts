export const sellerCapacityMap = {
  owner: 'OWNER',
  broker: 'BROKER',
  proxy: 'PROXY',
} as const;

export const propertyTypeMap = {
  'house-lot': 'HOUSE_LOT',
  'raw-land': 'RAW_LAND',
} as const;

export const terrainMap = {
  flat: 'FLAT',
  sloping: 'SLOPING',
  rolling: 'ROLLING',
  mountainous: 'MOUNTAINOUS',
} as const;

export const furnishingMap = {
  bare: 'BARE',
  'semi-furnished': 'SEMI_FURNISHED',
  'fully-furnished': 'FULLY_FURNISHED',
} as const;

export const titleTypeMap = {
  tct: 'TCT',
  oct: 'OCT',
  'tax-declaration': 'TAX_DECLARATION',
} as const;

export const negotiabilityMap = {
  fixed: 'FIXED',
  negotiable: 'NEGOTIABLE',
} as const;

export const taxResponsibilitiesMap = {
  seller: 'SELLER',
  buyer: 'BUYER',
  'standard-sharing': 'STANDARD_SHARING',
} as const;

export const HOUSE_ONLY_FIELDS = [
  'floorArea',
  'bedrooms',
  'bathrooms',
  'parkingSpaces',
  'yearBuilt',
  'furnishing',
];
