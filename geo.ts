/**
 * Geographic coordinate validation, Haversine distance calculation,
 * and Ray-Casting point-in-polygon verification for delivery zone checks.
 */

export function isValidCoordinates(lat: unknown, lng: unknown): boolean {
  const latNum = typeof lat === 'string' ? Number(lat) : (lat as number);
  const lngNum = typeof lng === 'string' ? Number(lng) : (lng as number);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return false;
  if (latNum < -90 || latNum > 90) return false;
  if (lngNum < -180 || lngNum > 180) return false;
  // Reject (0, 0) null-island coordinates
  if (Math.abs(latNum) < 0.0001 && Math.abs(lngNum) < 0.0001) return false;
  return true;
}

/**
 * Calculates great-circle distance between two coordinates in kilometers
 * using the Haversine formula.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371.0; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/**
 * Checks whether a point [lng, lat] is inside a GeoJSON Polygon ring.
 */
export function isPointInPolygon(
  lat: number,
  lng: number,
  polygonGeojson?: { type?: string; coordinates?: [number, number][][] } | null
): boolean {
  if (
    !polygonGeojson ||
    polygonGeojson.type !== 'Polygon' ||
    !Array.isArray(polygonGeojson.coordinates) ||
    polygonGeojson.coordinates.length === 0
  ) {
    return true; // If no polygon boundary is stored, rely on radius check
  }

  const ring = polygonGeojson.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
