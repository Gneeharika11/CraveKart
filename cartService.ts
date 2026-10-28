import { pool, executeInTransaction, DbClient } from '../db/pool.js';
import { calculateOrderPricing, PriceBreakdownResult, fromPaise, toPaise } from '../utils/money.js';

export const CROSS_BRANCH_CONFIRMATION_MESSAGE =
  'Your cart contains items from another restaurant. Would you like to clear your cart and add this item?';

export interface CartItemDTO {
  id: string;
  menuItemId: string;
  branchId: string;
  name: string;
  description: string;
  imageUrl: string;
  categoryName: string;
  isVeg: boolean;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  isAvailable: boolean;
  specialInstructions: string;
}

export interface CartDTO {
  cartId: string;
  userId: string;
  branchId: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  restaurantSlug: string | null;
  branchName: string | null;
  branchLocality: string | null;
  estimatedDeliveryTime: string | null;
  minOrderAmount: string;
  meetsMinOrder: boolean;
  couponCode: string | null;
  itemCount: number;
  items: CartItemDTO[];
  pricing: PriceBreakdownResult;
}

export async function getUserCart(userId: string, clientParam?: DbClient): Promise<CartDTO> {
  const queryRunner = clientParam || pool;

  // Ensure a cart row exists for the user
  let cartRes = await queryRunner.query(
    `SELECT c.id, c.user_id, c.branch_id, c.coupon_code,
            b.restaurant_id, b.branch_name, b.locality AS branch_locality,
            b.delivery_fee, b.min_order_amount, b.estimated_delivery_time,
            r.name AS restaurant_name, r.slug AS restaurant_slug
     FROM carts c
     LEFT JOIN restaurant_branches b ON b.id = c.branch_id
     LEFT JOIN restaurants r ON r.id = b.restaurant_id
     WHERE c.user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (cartRes.rowCount === 0) {
    await queryRunner.query(
      `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    cartRes = await queryRunner.query(
      `SELECT c.id, c.user_id, c.branch_id, c.coupon_code,
              b.restaurant_id, b.branch_name, b.locality AS branch_locality,
              b.delivery_fee, b.min_order_amount, b.estimated_delivery_time,
              r.name AS restaurant_name, r.slug AS restaurant_slug
       FROM carts c
       LEFT JOIN restaurant_branches b ON b.id = c.branch_id
       LEFT JOIN restaurants r ON r.id = b.restaurant_id
       WHERE c.user_id = $1
       LIMIT 1`,
      [userId]
    );
  }

  const cartRow = cartRes.rows[0];

  const itemsRes = await queryRunner.query(
    `SELECT ci.id, ci.menu_item_id, ci.branch_id, ci.quantity, ci.special_instructions,
            m.name, m.description, m.image_url, m.is_veg, m.base_price, m.is_available AS global_available,
            fc.name AS category_name,
            bmi.effective_price, bmi.is_available AS branch_available
     FROM cart_items ci
     INNER JOIN menu_items m ON m.id = ci.menu_item_id
     INNER JOIN food_categories fc ON fc.id = m.category_id
     LEFT JOIN branch_menu_items bmi ON bmi.branch_id = ci.branch_id AND bmi.menu_item_id = ci.menu_item_id
     WHERE ci.cart_id = $1
     ORDER BY ci.created_at ASC`,
    [cartRow.id]
  );

  // If cart has no items but still had a stale branch_id, clean it up
  if (itemsRes.rowCount === 0 && cartRow.branch_id) {
    await queryRunner.query(
      `UPDATE carts SET branch_id = NULL, coupon_code = NULL, updated_at = now() WHERE id = $1`,
      [cartRow.id]
    );
    cartRow.branch_id = null;
    cartRow.restaurant_id = null;
    cartRow.restaurant_name = null;
    cartRow.restaurant_slug = null;
    cartRow.branch_name = null;
    cartRow.branch_locality = null;
    cartRow.coupon_code = null;
  }

  const items: CartItemDTO[] = [];
  let itemCount = 0;

  for (const row of itemsRes.rows) {
    const unitPriceStr = fromPaise(toPaise(row.effective_price ?? row.base_price));
    const lineTotalStr = fromPaise(toPaise(unitPriceStr) * Number(row.quantity));
    const isAvail = Boolean(row.global_available && (row.branch_available ?? true));

    items.push({
      id: row.id,
      menuItemId: row.menu_item_id,
      branchId: row.branch_id,
      name: row.name,
      description: row.description,
      imageUrl: row.image_url,
      categoryName: row.category_name,
      isVeg: row.is_veg,
      unitPrice: unitPriceStr,
      quantity: Number(row.quantity),
      lineTotal: lineTotalStr,
      isAvailable: isAvail,
      specialInstructions: row.special_instructions || '',
    });
    itemCount += Number(row.quantity);
  }

  const pricing = calculateOrderPricing({
    items: items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity })),
    branchDeliveryFee: cartRow.delivery_fee ?? '0.00',
    couponCode: cartRow.coupon_code,
  });

  const minOrderAmountStr = fromPaise(toPaise(cartRow.min_order_amount ?? '0.00'));
  const meetsMinOrder =
    items.length === 0 ? false : toPaise(pricing.subtotal) >= toPaise(minOrderAmountStr);

  return {
    cartId: cartRow.id,
    userId,
    branchId: cartRow.branch_id || null,
    restaurantId: cartRow.restaurant_id || null,
    restaurantName: cartRow.restaurant_name || null,
    restaurantSlug: cartRow.restaurant_slug || null,
    branchName: cartRow.branch_name || null,
    branchLocality: cartRow.branch_locality || null,
    estimatedDeliveryTime: cartRow.estimated_delivery_time || null,
    minOrderAmount: minOrderAmountStr,
    meetsMinOrder,
    couponCode: cartRow.coupon_code || null,
    itemCount,
    items,
    pricing,
  };
}

export async function addItemToCart(params: {
  userId: string;
  branchId: string;
  menuItemId: string;
  quantity: number;
  specialInstructions?: string;
  forceClear?: boolean;
}): Promise<CartDTO> {
  const { userId, branchId, menuItemId, quantity, specialInstructions = '', forceClear = false } = params;

  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
    const err: any = new Error('Quantity must be a whole number between 1 and 50.');
    err.statusCode = 400;
    err.code = 'INVALID_QUANTITY';
    throw err;
  }

  return await executeInTransaction(async (client) => {
    // 1. Validate branch & menu item relationship and availability
    const bmRes = await client.query(
      `SELECT bmi.id, bmi.effective_price, bmi.is_available AS branch_item_available,
              m.name AS item_name, m.is_available AS global_item_available, m.restaurant_id AS item_restaurant_id,
              b.id AS branch_id, b.branch_name, b.restaurant_id AS branch_restaurant_id,
              b.is_active AS branch_active, b.is_delivery_available
       FROM branch_menu_items bmi
       INNER JOIN menu_items m ON m.id = bmi.menu_item_id
       INNER JOIN restaurant_branches b ON b.id = bmi.branch_id
       WHERE bmi.branch_id = $1 AND bmi.menu_item_id = $2
       LIMIT 1`,
      [branchId, menuItemId]
    );

    if (bmRes.rowCount === 0) {
      const err: any = new Error('Selected menu item does not belong to this restaurant branch.');
      err.statusCode = 404;
      err.code = 'BRANCH_MENU_ITEM_NOT_FOUND';
      throw err;
    }

    const bmRow = bmRes.rows[0];
    if (!bmRow.branch_active || !bmRow.is_delivery_available) {
      const err: any = new Error('This restaurant branch is currently not accepting deliveries.');
      err.statusCode = 400;
      err.code = 'BRANCH_UNAVAILABLE';
      throw err;
    }

    if (!bmRow.branch_item_available || !bmRow.global_item_available) {
      const err: any = new Error(
        `"${bmRow.item_name}" is currently unavailable at ${bmRow.branch_name} and cannot be added to the cart.`
      );
      err.statusCode = 400;
      err.code = 'ITEM_UNAVAILABLE';
      throw err;
    }

    // 2. Ensure cart exists for user
    await client.query(
      `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const cartRes = await client.query(
      `SELECT id, branch_id FROM carts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const cart = cartRes.rows[0];

    const existingItemsCountRes = await client.query(
      `SELECT COUNT(*)::INT AS cnt FROM cart_items WHERE cart_id = $1`,
      [cart.id]
    );
    const existingCount = existingItemsCountRes.rows[0]?.cnt || 0;

    // 3. Enforce Single-Branch Cart Rule
    if (existingCount > 0 && cart.branch_id && cart.branch_id !== branchId) {
      if (!forceClear) {
        const err: any = new Error(CROSS_BRANCH_CONFIRMATION_MESSAGE);
        err.statusCode = 409;
        err.code = 'CROSS_BRANCH_CONFLICT';
        err.conflictMessage = CROSS_BRANCH_CONFIRMATION_MESSAGE;
        throw err;
      }
      // User confirmed clearing the cart
      await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cart.id]);
      await client.query(
        `UPDATE carts SET branch_id = $1, coupon_code = NULL, updated_at = now() WHERE id = $2`,
        [branchId, cart.id]
      );
    } else if (cart.branch_id !== branchId) {
      await client.query(
        `UPDATE carts SET branch_id = $1, updated_at = now() WHERE id = $2`,
        [branchId, cart.id]
      );
    }

    // 4. Upsert cart item
    const existingItemRes = await client.query(
      `SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND menu_item_id = $2 LIMIT 1`,
      [cart.id, menuItemId]
    );

    if (existingItemRes.rowCount && existingItemRes.rowCount > 0) {
      const newQty = Number(existingItemRes.rows[0].quantity) + quantity;
      if (newQty > 50) {
        const err: any = new Error('Maximum quantity per item is 50.');
        err.statusCode = 400;
        err.code = 'MAX_QUANTITY_EXCEEDED';
        throw err;
      }
      await client.query(
        `UPDATE cart_items
         SET quantity = $1, special_instructions = COALESCE(NULLIF($2, ''), special_instructions), updated_at = now()
         WHERE id = $3`,
        [newQty, specialInstructions, existingItemRes.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO cart_items (cart_id, branch_id, menu_item_id, quantity, special_instructions)
         VALUES ($1, $2, $3, $4, $5)`,
        [cart.id, branchId, menuItemId, quantity, specialInstructions]
      );
    }

    await client.query(`UPDATE carts SET updated_at = now() WHERE id = $1`, [cart.id]);
    return await getUserCart(userId, client);
  });
}

export async function updateCartItemQuantity(params: {
  userId: string;
  cartItemId: string;
  quantity: number;
}): Promise<CartDTO> {
  const { userId, cartItemId, quantity } = params;

  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 50) {
    const err: any = new Error('Quantity must be an integer between 0 and 50.');
    err.statusCode = 400;
    err.code = 'INVALID_QUANTITY';
    throw err;
  }

  return await executeInTransaction(async (client) => {
    // Verify ownership of the cart item
    const checkRes = await client.query(
      `SELECT ci.id, ci.cart_id
       FROM cart_items ci
       INNER JOIN carts c ON c.id = ci.cart_id
       WHERE ci.id = $1 AND c.user_id = $2
       LIMIT 1`,
      [cartItemId, userId]
    );

    if (checkRes.rowCount === 0) {
      const err: any = new Error('Cart item not found or does not belong to your account.');
      err.statusCode = 404;
      err.code = 'CART_ITEM_NOT_FOUND';
      throw err;
    }

    if (quantity === 0) {
      await client.query(`DELETE FROM cart_items WHERE id = $1`, [cartItemId]);
    } else {
      await client.query(
        `UPDATE cart_items SET quantity = $1, updated_at = now() WHERE id = $2`,
        [quantity, cartItemId]
      );
    }

    return await getUserCart(userId, client);
  });
}

export async function removeCartItem(userId: string, cartItemId: string): Promise<CartDTO> {
  return await updateCartItemQuantity({ userId, cartItemId, quantity: 0 });
}

export async function clearUserCart(userId: string): Promise<CartDTO> {
  return await executeInTransaction(async (client) => {
    const cartRes = await client.query(`SELECT id FROM carts WHERE user_id = $1 LIMIT 1`, [userId]);
    if (cartRes.rowCount && cartRes.rowCount > 0) {
      const cartId = cartRes.rows[0].id;
      await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
      await client.query(
        `UPDATE carts SET branch_id = NULL, coupon_code = NULL, updated_at = now() WHERE id = $1`,
        [cartId]
      );
    }
    return await getUserCart(userId, client);
  });
}

export async function applyCartCoupon(
  userId: string,
  couponCode: string | null
): Promise<CartDTO> {
  return await executeInTransaction(async (client) => {
    const cleanCoupon = couponCode ? couponCode.trim().toUpperCase() : null;
    if (cleanCoupon && !['CRAVE75', 'FIRST50', 'CRAVE20'].includes(cleanCoupon)) {
      const err: any = new Error(
        'Invalid coupon code. Valid demonstration coupons are CRAVE75, FIRST50, or CRAVE20.'
      );
      err.statusCode = 400;
      err.code = 'INVALID_COUPON';
      throw err;
    }
    await client.query(
      `UPDATE carts SET coupon_code = $1, updated_at = now() WHERE user_id = $2`,
      [cleanCoupon, userId]
    );
    return await getUserCart(userId, client);
  });
}
