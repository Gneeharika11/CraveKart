import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import {
  fetchAutocompleteSuggestions,
  resolveAndValidatePlaceId,
  checkBranchDeliveryEligibility,
  isGoogleMapsKeyConfigured,
  VERIFIED_PLACE_CATALOG,
} from '../services/addressService.js';

export const addressesRouter = Router();

const autocompleteSchema = z.object({
  input: z.string().trim().min(1, 'Search input is required.').max(200),
  sessionToken: z.string().trim().max(120).optional(),
});

const createAddressSchema = z.object({
  placeId: z
    .string({
      required_error:
        'A validated Google Maps Place ID is required. Arbitrary text addresses are not accepted.',
    })
    .trim()
    .min(5, 'Please select a valid address suggestion from the autocomplete list.'),
  sessionToken: z.string().trim().optional(),
  addressLabel: z
    .string()
    .trim()
    .min(1, 'Address label is required (e.g. Home, Work, Hostel).')
    .max(40)
    .default('Home'),
  houseFlatNo: z
    .string()
    .trim()
    .min(1, 'House / Flat / Apartment number is required.')
    .max(120),
  buildingName: z.string().trim().max(150).optional().default(''),
  floorNumber: z.string().trim().max(50).optional().default(''),
  landmark: z.string().trim().max(200).optional().default(''),
  deliveryInstructions: z.string().trim().max(500).optional().default(''),
  isDefault: z.boolean().optional().default(false),
});

const updateAddressSchema = z.object({
  addressLabel: z.string().trim().min(1).max(40).optional(),
  houseFlatNo: z.string().trim().min(1).max(120).optional(),
  buildingName: z.string().trim().max(150).optional(),
  floorNumber: z.string().trim().max(50).optional(),
  landmark: z.string().trim().max(200).optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  isDefault: z.boolean().optional(),
});

function mapAddressRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    addressLabel: row.address_label,
    formattedAddress: row.formatted_address,
    placeId: row.place_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    houseFlatNo: row.house_flat_no,
    buildingName: row.building_name,
    floorNumber: row.floor_number,
    landmark: row.landmark,
    deliveryInstructions: row.delivery_instructions,
    locality: row.locality,
    city: row.city,
    postalCode: row.postal_code,
    validationSource: row.validation_source,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
  };
}

// GET /api/addresses/config-status
addressesRouter.get('/config-status', (_req: Request, res: Response) => {
  const configured = isGoogleMapsKeyConfigured();
  res.json({
    googleMapsConfigured: configured,
    mode: configured ? 'LIVE_GOOGLE_PLACES_NEW' : 'VERIFIED_DEMO_CATALOG',
    message: configured
      ? 'Google Maps Places API (New) and Geocoding API are live and configured.'
      : 'GOOGLE_MAPS_SERVER_API_KEY is not set in backend/.env. Using the server-verified Chennai Place ID registry for demonstration. Add GOOGLE_MAPS_SERVER_API_KEY and VITE_GOOGLE_MAPS_API_KEY to enable live Google Maps Platform API queries.',
    verifiedSamplePlaces: Object.values(VERIFIED_PLACE_CATALOG).map((p) => ({
      placeId: p.placeId,
      displayName: p.displayName,
      formattedAddress: p.formattedAddress,
      locality: p.locality,
      city: p.city,
    })),
  });
});

// POST /api/addresses/autocomplete
addressesRouter.post(
  '/autocomplete',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = autocompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid autocomplete query.',
        });
        return;
      }

      const result = await fetchAutocompleteSuggestions(
        parsed.data.input,
        parsed.data.sessionToken
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/addresses/validate-place
addressesRouter.post(
  '/validate-place',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const placeId = typeof req.body?.placeId === 'string' ? req.body.placeId : '';
      const sessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken : undefined;
      const branchId = typeof req.body?.branchId === 'string' ? req.body.branchId : undefined;

      const validatedPlace = await resolveAndValidatePlaceId(placeId, sessionToken);

      let deliveryCheck = null;
      if (branchId) {
        deliveryCheck = await checkBranchDeliveryEligibility(
          branchId,
          validatedPlace.latitude,
          validatedPlace.longitude
        );
      }

      res.json({
        valid: true,
        place: validatedPlace,
        deliveryCheck,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/addresses/check-eligibility
addressesRouter.post(
  '/check-eligibility',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const branchId = typeof req.body?.branchId === 'string' ? req.body.branchId.trim() : '';
      const addressId = typeof req.body?.addressId === 'string' ? req.body.addressId.trim() : '';
      const placeId = typeof req.body?.placeId === 'string' ? req.body.placeId.trim() : '';

      if (!branchId) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'branchId is required to check delivery eligibility.',
        });
        return;
      }

      let lat: number;
      let lng: number;

      if (addressId) {
        if (!req.user) {
          res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Authentication required to check saved address eligibility.',
          });
          return;
        }
        const addrRes = await pool.query(
          `SELECT user_id, latitude, longitude FROM user_addresses WHERE id = $1 LIMIT 1`,
          [addressId]
        );
        if (addrRes.rowCount === 0) {
          res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found.' });
          return;
        }
        if (addrRes.rows[0].user_id !== req.user.id) {
          res.status(403).json({
            error: 'FORBIDDEN',
            message: 'You do not have permission to access this address.',
          });
          return;
        }
        lat = Number(addrRes.rows[0].latitude);
        lng = Number(addrRes.rows[0].longitude);
      } else if (placeId) {
        const place = await resolveAndValidatePlaceId(placeId);
        lat = place.latitude;
        lng = place.longitude;
      } else {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Either a saved addressId or a validated placeId is required.',
        });
        return;
      }

      const result = await checkBranchDeliveryEligibility(branchId, lat, lng);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/addresses
addressesRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT * FROM user_addresses
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [req.user!.id]
    );
    res.json({
      addresses: result.rows.map(mapAddressRow),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/addresses
addressesRouter.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message:
          parsed.error.issues[0]?.message ||
          'Please select a valid Google Maps autocomplete suggestion and fill required fields.',
        details: parsed.error.issues,
      });
      return;
    }

    const {
      placeId,
      sessionToken,
      addressLabel,
      houseFlatNo,
      buildingName,
      floorNumber,
      landmark,
      deliveryInstructions,
      isDefault,
    } = parsed.data;

    // Server-side validation of Place ID (never trusts client-supplied coordinates or raw text)
    const validatedPlace = await resolveAndValidatePlaceId(placeId, sessionToken);

    const existingCountRes = await pool.query(
      `SELECT COUNT(*)::INT AS cnt FROM user_addresses WHERE user_id = $1`,
      [req.user!.id]
    );
    const shouldBeDefault = isDefault || existingCountRes.rows[0].cnt === 0;

    if (shouldBeDefault) {
      await pool.query(
        `UPDATE user_addresses SET is_default = false, updated_at = now() WHERE user_id = $1`,
        [req.user!.id]
      );
    }

    const insertRes = await pool.query(
      `INSERT INTO user_addresses (
         user_id, address_label, formatted_address, place_id,
         latitude, longitude, house_flat_no, building_name,
         floor_number, landmark, delivery_instructions,
         locality, city, postal_code, validation_source, is_default
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        req.user!.id,
        addressLabel,
        validatedPlace.formattedAddress,
        validatedPlace.placeId,
        validatedPlace.latitude,
        validatedPlace.longitude,
        houseFlatNo,
        buildingName,
        floorNumber,
        landmark,
        deliveryInstructions,
        validatedPlace.locality,
        validatedPlace.city,
        validatedPlace.postalCode,
        validatedPlace.validationSource,
        shouldBeDefault,
      ]
    );

    const saved = mapAddressRow(insertRes.rows[0]);

    // Optional branch delivery check if branchId was provided
    let deliveryCheck = null;
    if (typeof req.body?.branchId === 'string' && req.body.branchId.trim()) {
      deliveryCheck = await checkBranchDeliveryEligibility(
        req.body.branchId.trim(),
        saved.latitude,
        saved.longitude
      );
    }

    res.status(201).json({
      message: 'Delivery address validated and saved to CockroachDB.',
      address: saved,
      deliveryCheck,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/addresses/:id
addressesRouter.patch(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const addressId = String(req.params.id || '').trim();
      const parsed = updateAddressSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid address update payload.',
        });
        return;
      }

      const checkRes = await pool.query(
        `SELECT id, user_id FROM user_addresses WHERE id = $1 LIMIT 1`,
        [addressId]
      );
      if (checkRes.rowCount === 0) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found.' });
        return;
      }
      if (checkRes.rows[0].user_id !== req.user!.id) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Access denied: You cannot modify another user’s address.',
        });
        return;
      }

      const data = parsed.data;
      if (data.isDefault) {
        await pool.query(
          `UPDATE user_addresses SET is_default = false, updated_at = now() WHERE user_id = $1`,
          [req.user!.id]
        );
      }

      const updRes = await pool.query(
        `UPDATE user_addresses
         SET address_label = COALESCE($1, address_label),
             house_flat_no = COALESCE($2, house_flat_no),
             building_name = COALESCE($3, building_name),
             floor_number = COALESCE($4, floor_number),
             landmark = COALESCE($5, landmark),
             delivery_instructions = COALESCE($6, delivery_instructions),
             is_default = COALESCE($7, is_default),
             updated_at = now()
         WHERE id = $8 AND user_id = $9
         RETURNING *`,
        [
          data.addressLabel ?? null,
          data.houseFlatNo ?? null,
          data.buildingName ?? null,
          data.floorNumber ?? null,
          data.landmark ?? null,
          data.deliveryInstructions ?? null,
          data.isDefault ?? null,
          addressId,
          req.user!.id,
        ]
      );

      res.json({
        message: 'Address updated successfully.',
        address: mapAddressRow(updRes.rows[0]),
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/addresses/:id
addressesRouter.delete(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const addressId = String(req.params.id || '').trim();
      const checkRes = await pool.query(
        `SELECT id, user_id, is_default FROM user_addresses WHERE id = $1 LIMIT 1`,
        [addressId]
      );
      if (checkRes.rowCount === 0) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Address not found.' });
        return;
      }
      if (checkRes.rows[0].user_id !== req.user!.id) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Access denied: You cannot delete another user’s address.',
        });
        return;
      }

      await pool.query(`DELETE FROM user_addresses WHERE id = $1 AND user_id = $2`, [
        addressId,
        req.user!.id,
      ]);

      // If deleted address was default, promote most recent remaining address
      if (checkRes.rows[0].is_default) {
        await pool.query(
          `UPDATE user_addresses
           SET is_default = true
           WHERE id = (
             SELECT id FROM user_addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
           )`,
          [req.user!.id]
        );
      }

      res.json({ message: 'Address deleted successfully.' });
    } catch (err) {
      next(err);
    }
  }
);
