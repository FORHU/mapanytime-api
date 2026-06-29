import { haversineKm, roundKm } from '../../src/utils/geo.util';

describe('geo.util', () => {
  describe('haversineKm', () => {
    it('returns 0 for identical coordinates', () => {
      expect(haversineKm(14.6, 120.98, 14.6, 120.98)).toBe(0);
    });

    it('computes a known distance (Manila → Cebu ≈ 570 km)', () => {
      // Manila (14.5995, 120.9842) → Cebu City (10.3157, 123.8854)
      const km = haversineKm(14.5995, 120.9842, 10.3157, 123.8854);
      expect(km).toBeGreaterThan(560);
      expect(km).toBeLessThan(580);
    });

    it('is symmetric', () => {
      const a = haversineKm(14.6, 120.98, 14.7, 121.0);
      const b = haversineKm(14.7, 121.0, 14.6, 120.98);
      expect(a).toBeCloseTo(b, 10);
    });
  });

  describe('roundKm', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundKm(2.34567)).toBe(2.35);
      expect(roundKm(0.344)).toBe(0.34);
    });
  });

  describe('distance ordering (the nearby-stores use case)', () => {
    it('sorts stores nearest-first relative to a center point', () => {
      const center = { lat: 14.6, lng: 120.98 };
      const stores = [
        { id: 'far', lat: 14.9, lng: 121.3 },
        { id: 'near', lat: 14.61, lng: 120.99 },
        { id: 'mid', lat: 14.7, lng: 121.05 },
      ];

      const ordered = stores
        .map((s) => ({
          id: s.id,
          distanceKm: haversineKm(center.lat, center.lng, s.lat, s.lng),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .map((s) => s.id);

      expect(ordered).toEqual(['near', 'mid', 'far']);
    });
  });
});
