import StoreRepository from '../repositories/store.repository';

export default class StoreService {
  static async getNearbyStores(userLat: number, userLng: number, radiusKm: number) {
    const stores = await StoreRepository.getActiveStoresWithLocations();

    return stores.filter((store) => {
      const loc = store.storeLocations;
      if (!loc) return false;

      const distance = this.calculateDistance(userLat, userLng, loc.latitude, loc.longitude);
      return distance <= radiusKm;
    }).map(store => ({
       ...store,
       DistanceKm: this.calculateDistance(userLat, userLng, store.storeLocations!.latitude, store.storeLocations!.longitude)
    })).sort((a, b) => a.DistanceKm - b.DistanceKm);
  }

  // Haversine formula
  private static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
}