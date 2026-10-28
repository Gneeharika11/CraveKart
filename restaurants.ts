import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.js';
import { fromPaise, toPaise } from '../utils/money.js';
import { haversineDistanceKm, isValidCoordinates } from '../utils/geo.js';

export const restaurantsRouter = Router();

// GET /api/categories
restaurantsRouter.get('/categories', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, description, image_url, display_order
       FROM food_categories
       WHERE is_active = true
       ORDER BY display_order ASC, name ASC`
    );
    res.json({
      categories: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        imageUrl: r.image_url,
        displayOrder: r.display_order,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/featured-items
restaurantsRouter.get('/featured-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categorySlug = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const params: unknown[] = [];
    const conditions: string[] = ['m.is_available = true', 'r.is_active = true'];

    if (categorySlug) {
      params.push(categorySlug);
      conditions.push(`fc.slug = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(m.name ILIKE $${params.length} OR m.description ILIKE $${params.length} OR r.name ILIKE $${params.length} OR fc.name ILIKE $${params.length})`
      );
    }

    const sql = `
      SELECT m.id, m.name, m.slug, m.description, m.image_url, m.is_veg,
             m.spice_level, m.serves_info, m.is_bestseller, m.base_price,
             fc.name AS category_name, fc.slug AS category_slug,
             r.id AS restaurant_id, r.name AS restaurant_name, r.slug AS restaurant_slug, r.rating AS restaurant_rating,
             (SELECT b.id FROM restaurant_branches b WHERE b.restaurant_id = r.id AND b.is_active = true ORDER BY b.branch_name ASC LIMIT 1) AS default_branch_id,
             (SELECT b.branch_name FROM restaurant_branches b WHERE b.restaurant_id = r.id AND b.is_active = true ORDER BY b.branch_name ASC LIMIT 1) AS default_branch_name
      FROM menu_items m
      INNER JOIN restaurants r ON r.id = m.restaurant_id
      INNER JOIN food_categories fc ON fc.id = m.category_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.is_bestseller DESC, r.rating DESC, m.name ASC
      LIMIT 18
    `;

    const result = await pool.query(sql, params);
    res.json({
      items: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        imageUrl: r.image_url,
        isVeg: Boolean(r.is_veg),
        spiceLevel: r.spice_level,
        servesInfo: r.serves_info,
        isBestseller: Boolean(r.is_bestseller),
        basePrice: fromPaise(toPaise(r.base_price)),
        categoryName: r.category_name,
        categorySlug: r.category_slug,
        restaurantId: r.restaurant_id,
        restaurantName: r.restaurant_name,
        restaurantSlug: r.restaurant_slug,
        restaurantRating: Number(r.restaurant_rating),
        defaultBranchId: r.default_branch_id,
        defaultBranchName: r.default_branch_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/restaurants
restaurantsRouter.get('/restaurants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const locality = typeof req.query.locality === 'string' ? req.query.locality.trim() : '';
    const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';

    const params: unknown[] = [];
    const conditions: string[] = ['r.is_active = true'];

    if (q) {
      params.push(`%${q}%`);
      const pIdx = `$${params.length}`;
      conditions.push(`(
        r.name ILIKE ${pIdx}
        OR r.cuisine ILIKE ${pIdx}
        OR r.description ILIKE ${pIdx}
        OR EXISTS (
          SELECT 1 FROM menu_items mi
          INNER JOIN food_categories fc ON fc.id = mi.category_id
          WHERE mi.restaurant_id = r.id
            AND (mi.name ILIKE ${pIdx} OR fc.name ILIKE ${pIdx})
        )
        OR EXISTS (
          SELECT 1 FROM restaurant_branches rb
          WHERE rb.restaurant_id = r.id AND rb.locality ILIKE ${pIdx}
        )
      )`);
    }

    if (category) {
      params.push(category);
      const cIdx = `$${params.length}`;
      params.push(`%${category.replace(/-/g, ' ')}%`);
      const cNameIdx = `$${params.length}`;
      conditions.push(`(
        r.cuisine ILIKE ${cNameIdx}
        OR EXISTS (
          SELECT 1 FROM menu_items mi
          INNER JOIN food_categories fc ON fc.id = mi.category_id
          WHERE mi.restaurant_id = r.id AND (fc.slug = ${cIdx} OR fc.name ILIKE ${cNameIdx})
        )
      )`);
    }

    if (locality) {
      params.push(`%${locality}%`);
      const lIdx = `$${params.length}`;
      conditions.push(`EXISTS (
        SELECT 1 FROM restaurant_branches rb
        LEFT JOIN delivery_zones dz ON dz.branch_id = rb.id
        WHERE rb.restaurant_id = r.id
          AND rb.is_active = true
          AND (
            rb.locality ILIKE ${lIdx}
            OR EXISTS (
              SELECT 1 FROM unnest(dz.covered_localities) AS loc WHERE loc ILIKE ${lIdx}
            )
          )
      )`);
    }

    let orderBy = 'r.is_featured DESC, r.rating DESC, r.name ASC';
    if (sort === 'rating') {
      orderBy = 'r.rating DESC, r.review_count DESC';
    } else if (sort === 'popular') {
      orderBy = 'r.review_count DESC, r.rating DESC';
    }

    const sql = `
      SELECT r.id, r.name, r.slug, r.description, r.cuisine, r.image_url, r.banner_url,
             r.rating, r.review_count, r.price_range, r.is_featured, r.offer_badge, r.created_at
      FROM restaurants r
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
    `;

    const restRes = await pool.query(sql, params);
    const branchesRes = await pool.query(
      `SELECT id, restaurant_id, branch_name, branch_code, address, locality, city,
              latitude, longitude, opening_hours, contact_phone, delivery_fee, min_order_amount,
              estimated_delivery_time, delivery_radius_km, is_delivery_available
       FROM restaurant_branches
       WHERE is_active = true
       ORDER BY branch_name ASC`
    );

    const branchesByRestaurant = new Map<string, any[]>();
    for (const b of branchesRes.rows) {
      const list = branchesByRestaurant.get(b.restaurant_id) || [];
      list.push({
        id: b.id,
        restaurantId: b.restaurant_id,
        branchName: b.branch_name,
        branchCode: b.branch_code,
        address: b.address,
        locality: b.locality,
        city: b.city,
        latitude: Number(b.latitude),
        longitude: Number(b.longitude),
        openingHours: b.opening_hours,
        contactPhone: b.contact_phone || '+91 44 2815 4200',
        deliveryFee: fromPaise(toPaise(b.delivery_fee)),
        minOrderAmount: fromPaise(toPaise(b.min_order_amount)),
        estimatedDeliveryTime: b.estimated_delivery_time,
        deliveryRadiusKm: Number(b.delivery_radius_km),
        isDeliveryAvailable: Boolean(b.is_delivery_available),
      });
      branchesByRestaurant.set(b.restaurant_id, list);
    }

    const restaurants = restRes.rows.map((r) => {
      const brs = branchesByRestaurant.get(r.id) || [];
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        cuisine: r.cuisine,
        imageUrl: r.image_url,
        bannerUrl: r.banner_url,
        rating: Number(r.rating),
        reviewCount: Number(r.review_count),
        priceRange: r.price_range,
        isFeatured: Boolean(r.is_featured),
        offerBadge: r.offer_badge,
        branchCount: brs.length,
        localities: brs.map((b) => b.locality),
        estimatedDeliveryTime: brs[0]?.estimatedDeliveryTime || '25-35 mins',
        startingDeliveryFee: brs[0]?.deliveryFee || '30.00',
        branches: brs,
      };
    });

    res.json({ restaurants });
  } catch (err) {
    next(err);
  }
});

// GET /api/restaurants/:id (Supports UUID or slug)
restaurantsRouter.get('/restaurants/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idOrSlug = String(req.params.id || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

    const restRes = await pool.query(
      `SELECT id, name, slug, description, cuisine, image_url, banner_url,
              rating, review_count, price_range, is_featured, offer_badge, is_active, created_at
       FROM restaurants
       WHERE ${isUuid ? 'id = $1' : 'slug = $1'}
       LIMIT 1`,
      [idOrSlug]
    );

    if (restRes.rowCount === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Restaurant brand not found.' });
      return;
    }

    const r = restRes.rows[0];
    const branchesRes = await pool.query(
      `SELECT b.id, b.restaurant_id, b.branch_name, b.branch_code, b.address, b.locality, b.city,
              b.latitude, b.longitude, b.opening_hours, b.contact_phone, b.delivery_fee, b.min_order_amount,
              b.estimated_delivery_time, b.delivery_radius_km, b.is_delivery_available, b.is_active,
              dz.covered_localities, dz.max_radius_km
       FROM restaurant_branches b
       LEFT JOIN delivery_zones dz ON dz.branch_id = b.id AND dz.is_active = true
       WHERE b.restaurant_id = $1 AND b.is_active = true
       ORDER BY b.branch_name ASC`,
      [r.id]
    );

    res.json({
      restaurant: {
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        cuisine: r.cuisine,
        imageUrl: r.image_url,
        bannerUrl: r.banner_url,
        rating: Number(r.rating),
        reviewCount: Number(r.review_count),
        priceRange: r.price_range,
        isFeatured: Boolean(r.is_featured),
        offerBadge: r.offer_badge,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        branches: branchesRes.rows.map((b) => ({
          id: b.id,
          restaurantId: b.restaurant_id,
          branchName: b.branch_name,
          branchCode: b.branch_code,
          address: b.address,
          locality: b.locality,
          city: b.city,
          latitude: Number(b.latitude),
          longitude: Number(b.longitude),
          openingHours: b.opening_hours,
          contactPhone: b.contact_phone || '+91 44 2815 4200',
          deliveryFee: fromPaise(toPaise(b.delivery_fee)),
          minOrderAmount: fromPaise(toPaise(b.min_order_amount)),
          estimatedDeliveryTime: b.estimated_delivery_time,
          deliveryRadiusKm: Number(b.max_radius_km ?? b.delivery_radius_km),
          coveredLocalities: b.covered_localities || [],
          isDeliveryAvailable: Boolean(b.is_delivery_available),
          isActive: Boolean(b.is_active),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/restaurants/:id/branches
restaurantsRouter.get(
  '/restaurants/:id/branches',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idOrSlug = String(req.params.id || '').trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

      const restRes = await pool.query(
        `SELECT id, name, slug FROM restaurants WHERE ${isUuid ? 'id = $1' : 'slug = $1'} LIMIT 1`,
        [idOrSlug]
      );

      if (restRes.rowCount === 0) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Restaurant brand not found.' });
        return;
      }

      const restaurantId = restRes.rows[0].id;
      const branchesRes = await pool.query(
        `SELECT b.id, b.restaurant_id, b.branch_name, b.branch_code, b.address, b.locality, b.city,
                b.latitude, b.longitude, b.opening_hours, b.contact_phone, b.delivery_fee, b.min_order_amount,
                b.estimated_delivery_time, b.delivery_radius_km, b.is_delivery_available, b.is_active,
                dz.covered_localities, dz.max_radius_km
         FROM restaurant_branches b
         LEFT JOIN delivery_zones dz ON dz.branch_id = b.id AND dz.is_active = true
         WHERE b.restaurant_id = $1 AND b.is_active = true
         ORDER BY b.branch_name ASC`,
        [restaurantId]
      );

      const userLat = req.query.lat ? Number(req.query.lat) : null;
      const userLng = req.query.lng ? Number(req.query.lng) : null;
      const hasCoords = isValidCoordinates(userLat, userLng);

      res.json({
        restaurant: restRes.rows[0],
        branches: branchesRes.rows.map((b) => {
          const bLat = Number(b.latitude);
          const bLng = Number(b.longitude);
          const radius = Number(b.max_radius_km ?? b.delivery_radius_km);
          const distanceKm = hasCoords
            ? haversineDistanceKm(bLat, bLng, userLat!, userLng!)
            : null;
          return {
            id: b.id,
            restaurantId: b.restaurant_id,
            branchName: b.branch_name,
            branchCode: b.branch_code,
            address: b.address,
            locality: b.locality,
            city: b.city,
            latitude: bLat,
            longitude: bLng,
            openingHours: b.opening_hours,
            contactPhone: b.contact_phone || '+91 44 2815 4200',
            deliveryFee: fromPaise(toPaise(b.delivery_fee)),
            minOrderAmount: fromPaise(toPaise(b.min_order_amount)),
            estimatedDeliveryTime: b.estimated_delivery_time,
            deliveryRadiusKm: radius,
            coveredLocalities: b.covered_localities || [],
            isDeliveryAvailable: Boolean(b.is_delivery_available),
            isActive: Boolean(b.is_active),
            distanceKm,
            withinDeliveryZone: distanceKm !== null ? distanceKm <= radius : null,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/branches/:id
restaurantsRouter.get('/branches/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const branchId = String(req.params.id || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId);

    const bRes = await pool.query(
      `SELECT b.id, b.restaurant_id, b.branch_name, b.branch_code, b.address, b.locality, b.city,
              b.latitude, b.longitude, b.opening_hours, b.contact_phone, b.delivery_fee, b.min_order_amount,
              b.estimated_delivery_time, b.delivery_radius_km, b.is_delivery_available, b.is_active,
              r.name AS restaurant_name, r.slug AS restaurant_slug, r.cuisine, r.rating,
              r.review_count, r.price_range, r.image_url AS restaurant_image, r.banner_url, r.offer_badge,
              dz.zone_name, dz.max_radius_km, dz.covered_localities
       FROM restaurant_branches b
       INNER JOIN restaurants r ON r.id = b.restaurant_id
       LEFT JOIN delivery_zones dz ON dz.branch_id = b.id AND dz.is_active = true
       WHERE ${isUuid ? 'b.id = $1' : 'b.branch_code = $1'}
       LIMIT 1`,
      [branchId]
    );

    if (bRes.rowCount === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Restaurant branch not found.' });
      return;
    }

    const b = bRes.rows[0];
    res.json({
      branch: {
        id: b.id,
        restaurantId: b.restaurant_id,
        restaurantName: b.restaurant_name,
        restaurantSlug: b.restaurant_slug,
        cuisine: b.cuisine,
        rating: Number(b.rating),
        reviewCount: Number(b.review_count),
        priceRange: b.price_range,
        restaurantImage: b.restaurant_image,
        bannerUrl: b.banner_url,
        offerBadge: b.offer_badge,
        branchName: b.branch_name,
        branchCode: b.branch_code,
        address: b.address,
        locality: b.locality,
        city: b.city,
        latitude: Number(b.latitude),
        longitude: Number(b.longitude),
        openingHours: b.opening_hours,
        contactPhone: b.contact_phone || '+91 44 2815 4200',
        deliveryFee: fromPaise(toPaise(b.delivery_fee)),
        minOrderAmount: fromPaise(toPaise(b.min_order_amount)),
        estimatedDeliveryTime: b.estimated_delivery_time,
        deliveryRadiusKm: Number(b.max_radius_km ?? b.delivery_radius_km),
        zoneName: b.zone_name || `${b.locality} Delivery Zone`,
        coveredLocalities: b.covered_localities || [],
        isDeliveryAvailable: Boolean(b.is_delivery_available),
        isActive: Boolean(b.is_active),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/branches/:id/menu
restaurantsRouter.get(
  '/branches/:id/menu',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const branchId = String(req.params.id || '').trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId);

      const branchRes = await pool.query(
        `SELECT b.id, b.branch_name, b.locality, b.delivery_fee, b.min_order_amount,
                b.estimated_delivery_time, b.is_delivery_available,
                r.id AS restaurant_id, r.name AS restaurant_name, r.slug AS restaurant_slug, r.cuisine
         FROM restaurant_branches b
         INNER JOIN restaurants r ON r.id = b.restaurant_id
         WHERE ${isUuid ? 'b.id = $1' : 'b.branch_code = $1'}
         LIMIT 1`,
        [branchId]
      );

      if (branchRes.rowCount === 0) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Restaurant branch not found.' });
        return;
      }

      const branch = branchRes.rows[0];
      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
      const diet = typeof req.query.diet === 'string' ? req.query.diet.trim().toLowerCase() : 'all';
      const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';

      const params: unknown[] = [branch.id];
      const conditions: string[] = ['bmi.branch_id = $1'];

      if (search) {
        params.push(`%${search}%`);
        conditions.push(
          `(m.name ILIKE $${params.length} OR m.description ILIKE $${params.length} OR fc.name ILIKE $${params.length})`
        );
      }

      if (category && category !== 'all') {
        params.push(category);
        conditions.push(`(fc.slug = $${params.length} OR fc.name ILIKE $${params.length})`);
      }

      if (diet === 'veg') {
        conditions.push('m.is_veg = true');
      } else if (diet === 'non-veg' || diet === 'nonveg') {
        conditions.push('m.is_veg = false');
      }

      let orderBy = 'fc.display_order ASC, bmi.is_available DESC, m.is_bestseller DESC, m.name ASC';
      if (sort === 'price_asc') {
        orderBy = 'bmi.effective_price ASC, m.name ASC';
      } else if (sort === 'price_desc') {
        orderBy = 'bmi.effective_price DESC, m.name ASC';
      } else if (sort === 'bestseller') {
        orderBy = 'm.is_bestseller DESC, bmi.effective_price ASC';
      }

      const menuRes = await pool.query(
        `SELECT bmi.id AS branch_menu_item_id,
                bmi.branch_id,
                bmi.menu_item_id,
                bmi.price_override,
                bmi.effective_price,
                bmi.is_available AS branch_available,
                bmi.stock_status,
                bmi.featured_at_branch,
                m.name,
                m.slug,
                m.description,
                m.image_url,
                m.is_veg,
                m.spice_level,
                m.serves_info,
                m.preparation_time_mins,
                m.is_bestseller,
                m.base_price,
                m.is_available AS global_available,
                fc.id AS category_id,
                fc.name AS category_name,
                fc.slug AS category_slug
         FROM branch_menu_items bmi
         INNER JOIN menu_items m ON m.id = bmi.menu_item_id
         INNER JOIN food_categories fc ON fc.id = m.category_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY ${orderBy}`,
        params
      );

      const items = menuRes.rows.map((row) => ({
        id: row.menu_item_id,
        branchMenuItemId: row.branch_menu_item_id,
        branchId: row.branch_id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        imageUrl: row.image_url,
        categoryId: row.category_id,
        categoryName: row.category_name,
        categorySlug: row.category_slug,
        isVeg: Boolean(row.is_veg),
        spiceLevel: row.spice_level,
        servesInfo: row.serves_info,
        preparationTimeMins: Number(row.preparation_time_mins),
        isBestseller: Boolean(row.is_bestseller),
        basePrice: fromPaise(toPaise(row.base_price)),
        priceOverride: row.price_override ? fromPaise(toPaise(row.price_override)) : null,
        effectivePrice: fromPaise(toPaise(row.effective_price)),
        isAvailable: Boolean(row.branch_available && row.global_available),
        stockStatus: row.stock_status,
      }));

      res.json({
        branch: {
          id: branch.id,
          branchName: branch.branch_name,
          locality: branch.locality,
          restaurantId: branch.restaurant_id,
          restaurantName: branch.restaurant_name,
          restaurantSlug: branch.restaurant_slug,
          cuisine: branch.cuisine,
          deliveryFee: fromPaise(toPaise(branch.delivery_fee)),
          minOrderAmount: fromPaise(toPaise(branch.min_order_amount)),
          estimatedDeliveryTime: branch.estimated_delivery_time,
          isDeliveryAvailable: Boolean(branch.is_delivery_available),
        },
        menuItems: items,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/menu-items/:id
restaurantsRouter.get('/menu-items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idOrSlug = String(req.params.id || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

    const itemRes = await pool.query(
      `SELECT m.id, m.restaurant_id, m.category_id, m.name, m.slug, m.description,
              m.image_url, m.is_veg, m.spice_level, m.serves_info, m.preparation_time_mins,
              m.is_bestseller, m.base_price, m.is_available,
              fc.name AS category_name, fc.slug AS category_slug,
              r.name AS restaurant_name, r.slug AS restaurant_slug
       FROM menu_items m
       INNER JOIN food_categories fc ON fc.id = m.category_id
       INNER JOIN restaurants r ON r.id = m.restaurant_id
       WHERE ${isUuid ? 'm.id = $1' : 'm.slug = $1'}
       LIMIT 1`,
      [idOrSlug]
    );

    if (itemRes.rowCount === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Menu item not found.' });
      return;
    }

    const item = itemRes.rows[0];
    const branchPricingRes = await pool.query(
      `SELECT bmi.branch_id, b.branch_name, b.locality,
              bmi.price_override, bmi.effective_price, bmi.is_available, bmi.stock_status
       FROM branch_menu_items bmi
       INNER JOIN restaurant_branches b ON b.id = bmi.branch_id
       WHERE bmi.menu_item_id = $1 AND b.is_active = true
       ORDER BY b.branch_name ASC`,
      [item.id]
    );

    res.json({
      menuItem: {
        id: item.id,
        restaurantId: item.restaurant_id,
        restaurantName: item.restaurant_name,
        restaurantSlug: item.restaurant_slug,
        categoryId: item.category_id,
        categoryName: item.category_name,
        categorySlug: item.category_slug,
        name: item.name,
        slug: item.slug,
        description: item.description,
        imageUrl: item.image_url,
        isVeg: Boolean(item.is_veg),
        spiceLevel: item.spice_level,
        servesInfo: item.serves_info,
        preparationTimeMins: Number(item.preparation_time_mins),
        isBestseller: Boolean(item.is_bestseller),
        basePrice: fromPaise(toPaise(item.base_price)),
        isAvailable: Boolean(item.is_available),
        branchAvailability: branchPricingRes.rows.map((bp) => ({
          branchId: bp.branch_id,
          branchName: bp.branch_name,
          locality: bp.locality,
          priceOverride: bp.price_override ? fromPaise(toPaise(bp.price_override)) : null,
          effectivePrice: fromPaise(toPaise(bp.effective_price)),
          isAvailable: Boolean(bp.is_available && item.is_available),
          stockStatus: bp.stock_status,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});
