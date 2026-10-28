import { pool } from '../db/pool.js';
import { haversineDistanceKm, isPointInPolygon, isValidCoordinates } from '../utils/geo.js';

export interface ValidatedPlaceDetails {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  locality: string;
  city: string;
  postalCode: string;
  validationSource: 'GOOGLE_PLACES_API_NEW' | 'GOOGLE_GEOCODING_API' | 'VERIFIED_PLACE_REGISTRY';
}

export interface AutocompletePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  types: string[];
}

/**
 * Authoritative server-side verified Place ID registry used when demonstrating
 * or running automated tests without a live external Google Cloud billing key.
 * Arbitrary text or unverified placeIds are strictly rejected.
 */
export const VERIFIED_PLACE_CATALOG: Record<string, ValidatedPlaceDetails> = {
  ChIJN5X_g2VnUjoR_demo_tnagar_chennai: {
    placeId: 'ChIJN5X_g2VnUjoR_demo_tnagar_chennai',
    displayName: 'Panagal Park, T. Nagar',
    formattedAddress: 'Panagal Park, Usman Road, T. Nagar, Chennai, Tamil Nadu 600017, India',
    latitude: 13.0418,
    longitude: 80.2341,
    locality: 'T. Nagar',
    city: 'Chennai',
    postalCode: '600017',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_velachery_vijayanagar_chennai: {
    placeId: 'ChIJ_velachery_vijayanagar_chennai',
    displayName: 'Vijayanagar Bus Terminus, Velachery',
    formattedAddress: 'Velachery Main Road, Vijayanagar, Velachery, Chennai, Tamil Nadu 600042, India',
    latitude: 12.9766,
    longitude: 80.2212,
    locality: 'Velachery',
    city: 'Chennai',
    postalCode: '600042',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_adyar_gandhi_nagar_chennai: {
    placeId: 'ChIJ_adyar_gandhi_nagar_chennai',
    displayName: 'Gandhi Nagar, Adyar',
    formattedAddress: '1st Main Road, Gandhi Nagar, Adyar, Chennai, Tamil Nadu 600020, India',
    latitude: 13.0045,
    longitude: 80.2555,
    locality: 'Adyar',
    city: 'Chennai',
    postalCode: '600020',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_annanagar_tower_park_chennai: {
    placeId: 'ChIJ_annanagar_tower_park_chennai',
    displayName: 'Anna Nagar Tower Park',
    formattedAddress: '2nd Avenue, Y Block, Anna Nagar, Chennai, Tamil Nadu 600040, India',
    latitude: 13.0854,
    longitude: 80.2108,
    locality: 'Anna Nagar',
    city: 'Chennai',
    postalCode: '600040',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_nungambakkam_knk_road_chennai: {
    placeId: 'ChIJ_nungambakkam_knk_road_chennai',
    displayName: 'Khader Nawaz Khan Road, Nungambakkam',
    formattedAddress: 'Khader Nawaz Khan Road, Nungambakkam, Chennai, Tamil Nadu 600006, India',
    latitude: 13.061,
    longitude: 80.2501,
    locality: 'Nungambakkam',
    city: 'Chennai',
    postalCode: '600006',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_omr_thoraipakkam_chennai: {
    placeId: 'ChIJ_omr_thoraipakkam_chennai',
    displayName: 'Thoraipakkam OMR IT Corridor',
    formattedAddress: 'Rajiv Gandhi Salai (OMR), Thoraipakkam, Chennai, Tamil Nadu 600097, India',
    latitude: 12.9395,
    longitude: 80.2358,
    locality: 'OMR',
    city: 'Chennai',
    postalCode: '600097',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_tambaram_gst_road_chennai: {
    placeId: 'ChIJ_tambaram_gst_road_chennai',
    displayName: 'West Tambaram GST Road',
    formattedAddress: 'GST Road, West Tambaram, Chennai, Tamil Nadu 600045, India',
    latitude: 12.9255,
    longitude: 80.1015,
    locality: 'Tambaram',
    city: 'Chennai',
    postalCode: '600045',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_porur_mount_poonamallee_chennai: {
    placeId: 'ChIJ_porur_mount_poonamallee_chennai',
    displayName: 'Porur DLF Cybercity Road',
    formattedAddress: 'Mount Poonamallee High Road, Porur, Chennai, Tamil Nadu 600116, India',
    latitude: 13.0375,
    longitude: 80.1572,
    locality: 'Porur',
    city: 'Chennai',
    postalCode: '600116',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_guindy_kathipara_chennai: {
    placeId: 'ChIJ_guindy_kathipara_chennai',
    displayName: 'Guindy Industrial Estate',
    formattedAddress: 'GST Road, Guindy, Chennai, Tamil Nadu 600032, India',
    latitude: 13.0067,
    longitude: 80.2206,
    locality: 'Guindy',
    city: 'Chennai',
    postalCode: '600032',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_mylapore_kapaleeshwarar_chennai: {
    placeId: 'ChIJ_mylapore_kapaleeshwarar_chennai',
    displayName: 'Mylapore Tank, Luz Corner',
    formattedAddress: 'North Mada Street, Mylapore, Chennai, Tamil Nadu 600004, India',
    latitude: 13.0339,
    longitude: 80.2699,
    locality: 'Mylapore',
    city: 'Chennai',
    postalCode: '600004',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  // Out-of-zone verified place IDs (for testing out-of-delivery-zone rejection)
  ChIJ_out_of_zone_mahabalipuram: {
    placeId: 'ChIJ_out_of_zone_mahabalipuram',
    displayName: 'Shore Temple Road, Mahabalipuram',
    formattedAddress: 'East Coast Road, Mahabalipuram, Tamil Nadu 603104, India',
    latitude: 12.6162,
    longitude: 80.1927,
    locality: 'Mahabalipuram',
    city: 'Chengalpattu',
    postalCode: '603104',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
  ChIJ_out_of_zone_bengaluru_indiranagar: {
    placeId: 'ChIJ_out_of_zone_bengaluru_indiranagar',
    displayName: '100 Feet Road, Indiranagar, Bengaluru',
    formattedAddress: '100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038, India',
    latitude: 12.9784,
    longitude: 77.6408,
    locality: 'Indiranagar',
    city: 'Bengaluru',
    postalCode: '560038',
    validationSource: 'VERIFIED_PLACE_REGISTRY',
  },
};

export function isGoogleMapsKeyConfigured(): boolean {
  const key = (process.env.GOOGLE_MAPS_SERVER_API_KEY || '').trim();
  return (
    key.length > 10 &&
    !key.includes('YOUR_GOOGLE_MAPS') &&
    !key.includes('replace_with')
  );
}

/**
 * Calls Google Maps Places API (New) Autocomplete endpoint:
 * POST https://places.googleapis.com/v1/places:autocomplete
 * Includes mandatory X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1 header.
 */
export async function fetchAutocompleteSuggestions(
  input: string,
  sessionToken?: string
): Promise<{
  predictions: AutocompletePrediction[];
  mode: 'LIVE_GOOGLE_PLACES_NEW' | 'VERIFIED_DEMO_CATALOG';
  configNotice?: string;
}> {
  const trimmed = input.trim();
  if (trimmed.length < 2) {
    return {
      predictions: [],
      mode: isGoogleMapsKeyConfigured() ? 'LIVE_GOOGLE_PLACES_NEW' : 'VERIFIED_DEMO_CATALOG',
    };
  }

  if (isGoogleMapsKeyConfigured()) {
    const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY!.trim();
    const body: Record<string, unknown> = {
      input: trimmed,
      includedRegionCodes: ['in'],
      locationBias: {
        circle: {
          center: {
            latitude: 13.0418,
            longitude: 80.2341,
          },
          radius: 40000.0,
        },
      },
    };
    if (sessionToken) {
      body.sessionToken = sessionToken;
    }

    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-Maps-Solution-ID': 'gmp_git_agentskills_v1',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Places Autocomplete (New) failed (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
          types?: string[];
        };
      }>;
    };

    const predictions: AutocompletePrediction[] = [];
    for (const s of data.suggestions || []) {
      const pp = s.placePrediction;
      if (pp?.placeId) {
        predictions.push({
          placeId: pp.placeId,
          mainText: pp.structuredFormat?.mainText?.text || pp.text?.text || '',
          secondaryText: pp.structuredFormat?.secondaryText?.text || '',
          fullText: pp.text?.text || '',
          types: pp.types || [],
        });
      }
    }

    return {
      predictions,
      mode: 'LIVE_GOOGLE_PLACES_NEW',
    };
  }

  // When GOOGLE_MAPS_SERVER_API_KEY is not yet configured in .env:
  // Filter against the verified Place ID catalog and return an explicit configuration notice.
  const q = trimmed.toLowerCase();
  const matches = Object.values(VERIFIED_PLACE_CATALOG)
    .filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.formattedAddress.toLowerCase().includes(q) ||
        p.locality.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.postalCode.toLowerCase().includes(q)
    )
    .map((p) => ({
      placeId: p.placeId,
      mainText: p.displayName,
      secondaryText: p.formattedAddress,
      fullText: `${p.displayName} — ${p.formattedAddress}`,
      types: ['street_address', 'locality'],
    }));

  return {
    predictions: matches,
    mode: 'VERIFIED_DEMO_CATALOG',
    configNotice:
      'GOOGLE_MAPS_SERVER_API_KEY is not configured in backend/.env. Showing verified Chennai Place IDs from the server registry. Configure GOOGLE_MAPS_SERVER_API_KEY to enable live worldwide Google Maps Places API (New) autocomplete.',
  };
}

/**
 * Resolves and validates a Place ID on the backend.
 * NEVER trusts client-supplied coordinates or arbitrary strings.
 * Uses Places API (New) Place Details (`GET https://places.googleapis.com/v1/places/{placeId}`)
 * with mandatory field mask and `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`.
 */
export async function resolveAndValidatePlaceId(
  placeId: string,
  sessionToken?: string
): Promise<ValidatedPlaceDetails> {
  const cleanPlaceId = (placeId || '').trim();
  if (!cleanPlaceId || cleanPlaceId.length < 5 || /\s/.test(cleanPlaceId)) {
    const err: any = new Error(
      'Invalid Place ID. Please select a valid address suggestion from the autocomplete dropdown.'
    );
    err.statusCode = 400;
    err.code = 'INVALID_PLACE_ID';
    throw err;
  }

  // 1. Check verified server catalog first (supports seeded/demo/test Place IDs reliably)
  if (VERIFIED_PLACE_CATALOG[cleanPlaceId]) {
    return VERIFIED_PLACE_CATALOG[cleanPlaceId];
  }

  // 2. If not in the static catalog, require live Google Maps Server API Key
  if (!isGoogleMapsKeyConfigured()) {
    const err: any = new Error(
      'Unverified or unknown Place ID rejected. Live Google Maps API credentials (GOOGLE_MAPS_SERVER_API_KEY) are not configured to validate external Place IDs, and arbitrary addresses cannot bypass validation.'
    );
    err.statusCode = 400;
    err.code = 'UNVERIFIED_ADDRESS_REJECTED';
    throw err;
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY!.trim();
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(cleanPlaceId)}`);
  if (sessionToken) {
    url.searchParams.set('sessionToken', sessionToken);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents,types',
      'X-Goog-Maps-Solution-ID': 'gmp_git_agentskills_v1',
    },
  });

  if (!response.ok) {
    // Fallback to Geocoding API by place_id if Places API returned an error
    return await resolveViaGeocodingApi(cleanPlaceId, apiKey);
  }

  const data = (await response.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: Array<{
      longText?: string;
      shortText?: string;
      types?: string[];
    }>;
  };

  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  if (!data.id || !data.formattedAddress || !isValidCoordinates(lat, lng)) {
    const err: any = new Error(
      'Selected place returned incomplete geographic coordinates or address details.'
    );
    err.statusCode = 400;
    err.code = 'INCOMPLETE_PLACE_DETAILS';
    throw err;
  }

  let locality = '';
  let city = '';
  let postalCode = '';

  for (const comp of data.addressComponents || []) {
    const types = comp.types || [];
    if (types.includes('sublocality_level_1') || types.includes('sublocality') || types.includes('neighborhood')) {
      if (!locality) locality = comp.longText || '';
    }
    if (types.includes('locality') || types.includes('administrative_area_level_2')) {
      if (!city) city = comp.longText || '';
    }
    if (types.includes('postal_code')) {
      postalCode = comp.longText || '';
    }
  }

  return {
    placeId: data.id,
    displayName: data.displayName?.text || data.formattedAddress,
    formattedAddress: data.formattedAddress,
    latitude: Number(lat!.toFixed(7)),
    longitude: Number(lng!.toFixed(7)),
    locality: locality || city || 'Chennai',
    city: city || 'Chennai',
    postalCode,
    validationSource: 'GOOGLE_PLACES_API_NEW',
  };
}

async function resolveViaGeocodingApi(
  placeId: string,
  apiKey: string
): Promise<ValidatedPlaceDetails> {
  const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(
    placeId
  )}&key=${encodeURIComponent(apiKey)}&solution_id=gmp_git_agentskills_v1`;

  const res = await fetch(geoUrl);
  if (!res.ok) {
    const err: any = new Error('Failed to validate Place ID with Google Maps Geocoding API.');
    err.statusCode = 400;
    err.code = 'PLACE_VALIDATION_FAILED';
    throw err;
  }

  const body = (await res.json()) as {
    status?: string;
    results?: Array<{
      place_id?: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
      address_components?: Array<{ long_name?: string; types?: string[] }>;
    }>;
  };

  const first = body.results?.[0];
  const lat = first?.geometry?.location?.lat;
  const lng = first?.geometry?.location?.lng;

  if (body.status !== 'OK' || !first || !first.formatted_address || !isValidCoordinates(lat, lng)) {
    const err: any = new Error(
      'Invalid Place ID selection: Google Maps could not verify this location.'
    );
    err.statusCode = 400;
    err.code = 'INVALID_PLACE_ID';
    throw err;
  }

  let locality = '';
  let city = '';
  let postalCode = '';
  for (const comp of first.address_components || []) {
    const types = comp.types || [];
    if (types.includes('sublocality_level_1') || types.includes('sublocality')) {
      if (!locality) locality = comp.long_name || '';
    }
    if (types.includes('locality')) {
      if (!city) city = comp.long_name || '';
    }
    if (types.includes('postal_code')) {
      postalCode = comp.long_name || '';
    }
  }

  return {
    placeId: first.place_id || placeId,
    displayName: locality || first.formatted_address,
    formattedAddress: first.formatted_address,
    latitude: Number(lat!.toFixed(7)),
    longitude: Number(lng!.toFixed(7)),
    locality: locality || city || 'Chennai',
    city: city || 'Chennai',
    postalCode,
    validationSource: 'GOOGLE_GEOCODING_API',
  };
}

export interface DeliveryEligibilityResult {
  eligible: boolean;
  branchId: string;
  branchName: string;
  locality: string;
  distanceKm: number;
  maxRadiusKm: number;
  deliveryFee: string;
  estimatedDeliveryTime: string;
  message: string;
}

export const OUT_OF_ZONE_MESSAGE =
  'Sorry! This restaurant does not deliver to your selected location.';

/**
 * Server-side delivery-zone eligibility check against CockroachDB `restaurant_branches`
 * and `delivery_zones`. Checks:
 * 1. Valid coordinates
 * 2. Active restaurant branch
 * 3. Branch delivery availability
 * 4. Address within the configured delivery radius/polygon in Chennai
 */
export async function checkBranchDeliveryEligibility(
  branchId: string,
  latitude: number,
  longitude: number
): Promise<DeliveryEligibilityResult> {
  if (!isValidCoordinates(latitude, longitude)) {
    return {
      eligible: false,
      branchId,
      branchName: '',
      locality: '',
      distanceKm: 0,
      maxRadiusKm: 0,
      deliveryFee: '0.00',
      estimatedDeliveryTime: '',
      message: 'Invalid geographic coordinates for delivery address.',
    };
  }

  const branchRes = await pool.query(
    `SELECT b.id, b.branch_name, b.locality, b.city, b.latitude, b.longitude,
            b.delivery_fee, b.estimated_delivery_time, b.delivery_radius_km,
            b.is_delivery_available, b.is_active,
            r.is_active AS restaurant_active,
            dz.center_latitude, dz.center_longitude, dz.max_radius_km, dz.polygon_geojson
     FROM restaurant_branches b
     INNER JOIN restaurants r ON r.id = b.restaurant_id
     LEFT JOIN delivery_zones dz ON dz.branch_id = b.id AND dz.is_active = true
     WHERE b.id = $1
     LIMIT 1`,
    [branchId]
  );

  if (branchRes.rowCount === 0) {
    return {
      eligible: false,
      branchId,
      branchName: '',
      locality: '',
      distanceKm: 0,
      maxRadiusKm: 0,
      deliveryFee: '0.00',
      estimatedDeliveryTime: '',
      message: 'Selected restaurant branch was not found.',
    };
  }

  const row = branchRes.rows[0];
  const branchLat = Number(row.center_latitude ?? row.latitude);
  const branchLng = Number(row.center_longitude ?? row.longitude);
  const maxRadiusKm = Number(row.max_radius_km ?? row.delivery_radius_km ?? 8.5);
  const distanceKm = haversineDistanceKm(branchLat, branchLng, latitude, longitude);

  if (!row.is_active || !row.restaurant_active || !row.is_delivery_available) {
    return {
      eligible: false,
      branchId: row.id,
      branchName: row.branch_name,
      locality: row.locality,
      distanceKm,
      maxRadiusKm,
      deliveryFee: Number(row.delivery_fee).toFixed(2),
      estimatedDeliveryTime: row.estimated_delivery_time,
      message: OUT_OF_ZONE_MESSAGE,
    };
  }

  const withinRadius = distanceKm <= maxRadiusKm;
  const polygonData =
    typeof row.polygon_geojson === 'string'
      ? JSON.parse(row.polygon_geojson)
      : row.polygon_geojson;
  const withinPolygon = isPointInPolygon(latitude, longitude, polygonData);

  if (!withinRadius && !withinPolygon) {
    return {
      eligible: false,
      branchId: row.id,
      branchName: row.branch_name,
      locality: row.locality,
      distanceKm,
      maxRadiusKm,
      deliveryFee: Number(row.delivery_fee).toFixed(2),
      estimatedDeliveryTime: row.estimated_delivery_time,
      message: OUT_OF_ZONE_MESSAGE,
    };
  }

  return {
    eligible: true,
    branchId: row.id,
    branchName: row.branch_name,
    locality: row.locality,
    distanceKm,
    maxRadiusKm,
    deliveryFee: Number(row.delivery_fee).toFixed(2),
    estimatedDeliveryTime: row.estimated_delivery_time,
    message: `Deliverable from ${row.branch_name} (${distanceKm} km away, est. ${row.estimated_delivery_time}).`,
  };
}
