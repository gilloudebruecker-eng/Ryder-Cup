import type { GreenPoint } from './course';

const EARTH_RADIUS_METERS = 6_371_000;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMeters(from: GreenPoint, to: GreenPoint): number {
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
