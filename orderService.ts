import crypto from 'crypto';
import { pool, executeInTransaction, DbClient } from '../db/pool.js';
import { calculateOrderPricing, fromPaise, toPaise } from '../utils/money.js';
import {
  checkBranchDeliveryEligibility,
  OUT_OF_ZONE_MESSAGE,
} from './addressService.js';
import { isValidCoordinates } from '../utils/geo.js';

export type OrderStatus =
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export const VALID_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Generates a unique, human-readable order number: e.g. CK-20261028-4829
 * Uses date + cryptographic random digits/alphanumerics verified against the
 * UNIQUE constraint on orders(order_number).
 */
export async function generateUniqueOrderNumber(client: DbClient): Promise<string> {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePart = `${yyyy}${mm}${dd}`;

  for (let attempt = 0; attempt < 10; attempt++) {
    const randomNum = crypto.randomInt(1000, 9999);
    const suffix = attempt === 0 ? `${randomNum}` : `${randomNum}${crypto.randomInt(10, 99)}`;
    const candidate = `CK-${datePart}-${suffix}`;
    const existing = await client.query(
      'SELECT id FROM orders WHERE order_number = $1 LIMIT 1',
      [candidate]
    );
    if (existing.rowCount === 0) {
      return candidate;
    }
  }
  return `CK-${datePart}-${Date.now().toString().slice(-6)}`;
}

export interface PlaceOrderInput {
  userId: string;
  addressId: string;
  paymentMethod: 'COD' | 'SIMULATED_ONLINE';
  idempotencyKey?: string;
  specialNotes?: string;
  /**
   * Used exclusively by the automated test suite to verify atomic transaction
   * rollback when an unexpected failure occurs mid-transaction (Test #19).
   */
  simulateFailureAfterOrderInsert?: boolean;
}

export async function placeOrderTransactionally(input: PlaceOrderInput) {
  const {
    userId,
    addressId,
    paymentMethod,
    idempotencyKey,
    specialNotes = '',
    simulateFailureAfterOrderInsert = false,
  } = input;

  const cleanIdempotencyKey = idempotencyKey ? idempotencyKey.trim() : null;

  return await executeInTransaction(async (client) => {
    // 1. Check idempotency key first to prevent duplicate orders on network retry
    if (cleanIdempotencyKey) {
      const existingOrderRes = await client.query(
        `SELECT id, user_id FROM orders WHERE idempotency_key = $1 LIMIT 1`,
        [cleanIdempotencyKey]
      );
      if (existingOrderRes.rowCount && existingOrderRes.rowCount > 0) {
        const existingOrder = existingOrderRes.rows[0];
        if (existingOrder.user_id !== userId) {
          const err: any = new Error('Idempotency key conflict.');
          err.statusCode = 409;
          err.code = 'IDEMPOTENCY_CONFLICT';
          throw err;
        }
        return await getOrderByIdForUser(existingOrder.id, userId, client);
      }
    }

    // 2. Verify address ownership and validity
    const addrRes = await client.query(
      `SELECT id, user_id, address_label, formatted_address, place_id,
              latitude, longitude, house_flat_no, building_name, floor_number,
              landmark, delivery_instructions, locality, city, postal_code, validation_source
       FROM user_addresses
       WHERE id = $1
       LIMIT 1`,
      [addressId]
    );

    if (addrRes.rowCount === 0) {
      const err: any = new Error('Selected delivery address was not found.');
      err.statusCode = 404;
      err.code = 'ADDRESS_NOT_FOUND';
      throw err;
    }

    const address = addrRes.rows[0];
    if (address.user_id !== userId) {
      const err: any = new Error('Access denied: You do not own the selected delivery address.');
      err.statusCode = 403;
      err.code = 'ADDRESS_OWNERSHIP_VIOLATION';
      throw err;
    }

    const lat = Number(address.latitude);
    const lng = Number(address.longitude);
    if (!address.place_id || !isValidCoordinates(lat, lng)) {
      const err: any = new Error(
        'Selected address is missing verified geographic coordinates or Place ID.'
      );
      err.statusCode = 400;
      err.code = 'INVALID_SAVED_ADDRESS';
      throw err;
    }

    // 3. Retrieve cart and cart items from CockroachDB
    const cartRes = await client.query(
      `SELECT id, branch_id, coupon_code FROM carts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (cartRes.rowCount === 0 || !cartRes.rows[0].branch_id) {
      const err: any = new Error('Your shopping cart is empty.');
      err.statusCode = 400;
      err.code = 'EMPTY_CART';
      throw err;
    }

    const cart = cartRes.rows[0];
    const branchId: string = cart.branch_id;

    const cartItemsRes = await client.query(
      `SELECT ci.id, ci.branch_id, ci.menu_item_id, ci.quantity, ci.special_instructions,
              m.name AS item_name, m.image_url, m.is_veg, m.is_available AS global_available,
              fc.name AS category_name,
              bmi.effective_price, bmi.is_available AS branch_available
       FROM cart_items ci
       INNER JOIN menu_items m ON m.id = ci.menu_item_id
       INNER JOIN food_categories fc ON fc.id = m.category_id
       LEFT JOIN branch_menu_items bmi ON bmi.branch_id = ci.branch_id AND bmi.menu_item_id = ci.menu_item_id
       WHERE ci.cart_id = $1
       ORDER BY ci.created_at ASC`,
      [cart.id]
    );

    if (cartItemsRes.rowCount === 0) {
      const err: any = new Error('Your shopping cart is empty.');
      err.statusCode = 400;
      err.code = 'EMPTY_CART';
      throw err;
    }

    // 4. Verify branch is active & check delivery eligibility on backend
    const branchRes = await client.query(
      `SELECT b.id, b.restaurant_id, b.branch_name, b.locality, b.city,
              b.delivery_fee, b.min_order_amount, b.estimated_delivery_time,
              b.is_delivery_available, b.is_active,
              r.name AS restaurant_name, r.is_active AS restaurant_active
       FROM restaurant_branches b
       INNER JOIN restaurants r ON r.id = b.restaurant_id
       WHERE b.id = $1
       LIMIT 1`,
      [branchId]
    );

    if (branchRes.rowCount === 0) {
      const err: any = new Error('Selected restaurant branch does not exist.');
      err.statusCode = 404;
      err.code = 'BRANCH_NOT_FOUND';
      throw err;
    }

    const branch = branchRes.rows[0];
    if (!branch.is_active || !branch.restaurant_active || !branch.is_delivery_available) {
      const err: any = new Error(
        'Selected restaurant branch is currently inactive or not accepting orders.'
      );
      err.statusCode = 400;
      err.code = 'BRANCH_INACTIVE';
      throw err;
    }

    const eligibility = await checkBranchDeliveryEligibility(branchId, lat, lng);
    if (!eligibility.eligible) {
      const err: any = new Error(OUT_OF_ZONE_MESSAGE);
      err.statusCode = 400;
      err.code = 'OUT_OF_DELIVERY_ZONE';
      throw err;
    }

    // 5. Verify all cart items belong to the selected branch & are available
    const verifiedItems: Array<{
      menuItemId: string;
      itemName: string;
      categoryName: string;
      isVeg: boolean;
      imageUrl: string;
      unitPrice: string;
      quantity: number;
      lineTotal: string;
    }> = [];

    for (const row of cartItemsRes.rows) {
      if (row.branch_id !== branchId) {
        const err: any = new Error(
          'Cart integrity error: Cart contains items from multiple branches.'
        );
        err.statusCode = 400;
        err.code = 'CROSS_BRANCH_INTEGRITY_ERROR';
        throw err;
      }

      if (!row.global_available || !row.branch_available || row.effective_price === null) {
        const err: any = new Error(
          `Item "${row.item_name}" is no longer available at ${branch.branch_name}. Please remove it from your cart.`
        );
        err.statusCode = 400;
        err.code = 'ITEM_UNAVAILABLE';
        throw err;
      }

      const qty = Number(row.quantity);
      const unitPriceStr = fromPaise(toPaise(row.effective_price));
      const lineTotalStr = fromPaise(toPaise(unitPriceStr) * qty);

      verifiedItems.push({
        menuItemId: row.menu_item_id,
        itemName: row.item_name,
        categoryName: row.category_name,
        isVeg: Boolean(row.is_veg),
        imageUrl: row.image_url,
        unitPrice: unitPriceStr,
        quantity: qty,
        lineTotal: lineTotalStr,
      });
    }

    // 6. Recalculate subtotal, taxes, packaging fee, discounts, and final total on backend
    const pricing = calculateOrderPricing({
      items: verifiedItems.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity })),
      branchDeliveryFee: branch.delivery_fee,
      couponCode: cart.coupon_code,
    });

    if (toPaise(pricing.subtotal) < toPaise(branch.min_order_amount)) {
      const err: any = new Error(
        `Minimum order subtotal for ${branch.branch_name} is ₹${fromPaise(
          toPaise(branch.min_order_amount)
        )}.`
      );
      err.statusCode = 400;
      err.code = 'MIN_ORDER_NOT_MET';
      throw err;
    }

    // 7. Generate unique order number
    const orderNumber = await generateUniqueOrderNumber(client);

    // 8. Determine payment status
    // For COD: PENDING (never marked completed before cash is collected)
    // For SIMULATED_ONLINE: SIMULATED_PAID (clearly labelled as simulated demonstration)
    const paymentStatus = paymentMethod === 'COD' ? 'PENDING' : 'SIMULATED_PAID';

    const addressSnapshot = {
      id: address.id,
      addressLabel: address.address_label,
      formattedAddress: address.formatted_address,
      placeId: address.place_id,
      latitude: Number(address.latitude),
      longitude: Number(address.longitude),
      houseFlatNo: address.house_flat_no,
      buildingName: address.building_name,
      floorNumber: address.floor_number,
      landmark: address.landmark,
      deliveryInstructions: address.delivery_instructions,
      locality: address.locality,
      city: address.city,
      postalCode: address.postal_code,
    };

    // 9. Insert order record
    const orderInsertRes = await client.query(
      `INSERT INTO orders (
         order_number, idempotency_key, user_id, restaurant_id, branch_id, address_id,
         delivery_address_snapshot, subtotal, tax_amount, delivery_fee, packaging_fee,
         discount_amount, final_total, payment_method, payment_status, order_status,
         estimated_delivery_time, delivery_distance_km, special_notes
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15, 'CONFIRMED',
         $16, $17, $18
       )
       RETURNING id`,
      [
        orderNumber,
        cleanIdempotencyKey,
        userId,
        branch.restaurant_id,
        branch.id,
        address.id,
        JSON.stringify(addressSnapshot),
        pricing.subtotal,
        pricing.taxAmount,
        pricing.deliveryFee,
        pricing.packagingFee,
        pricing.discountAmount,
        pricing.finalTotal,
        paymentMethod,
        paymentStatus,
        branch.estimated_delivery_time,
        eligibility.distanceKm,
        specialNotes,
      ]
    );

    const orderId: string = orderInsertRes.rows[0].id;

    // Optional failure hook for automated test #19 (verifying atomic transaction rollback)
    if (simulateFailureAfterOrderInsert) {
      const err: any = new Error('Simulated mid-transaction failure to verify atomic rollback.');
      err.statusCode = 500;
      err.code = 'SIMULATED_TRANSACTION_FAILURE';
      throw err;
    }

    // 10. Insert immutable order_items snapshots
    for (const item of verifiedItems) {
      await client.query(
        `INSERT INTO order_items (
           order_id, menu_item_id, item_name_snapshot, category_name_snapshot,
           is_veg_snapshot, image_url_snapshot, unit_price_snapshot, quantity, line_total
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orderId,
          item.menuItemId,
          item.itemName,
          item.categoryName,
          item.isVeg,
          item.imageUrl,
          item.unitPrice,
          item.quantity,
          item.lineTotal,
        ]
      );
    }

    // 11. Insert payment record
    const isSimulated = paymentMethod === 'SIMULATED_ONLINE';
    const simRef = isSimulated ? `SIM-TXN-${orderNumber}` : null;
    const providerNote = isSimulated
      ? 'SIMULATED ONLINE PAYMENT (Academic Demonstration Only — No External Payment Gateway Charged)'
      : 'Cash on Delivery — Payment to be collected upon delivery';

    await client.query(
      `INSERT INTO payments (
         order_id, user_id, payment_method, payment_status, amount,
         currency, is_simulated, simulation_reference, provider_note, paid_at
       )
       VALUES ($1, $2, $3, $4, $5, 'INR', $6, $7, $8, $9)`,
      [
        orderId,
        userId,
        paymentMethod,
        paymentStatus,
        pricing.finalTotal,
        isSimulated,
        simRef,
        providerNote,
        isSimulated ? new Date().toISOString() : null,
      ]
    );

    // 12. Insert initial status history record
    await client.query(
      `INSERT INTO order_status_history (
         order_id, previous_status, new_status, actor_id, actor_source, note
       )
       VALUES ($1, NULL, 'CONFIRMED', $2, 'ORDER_PLACEMENT_TXN', 'Order placed and confirmed atomically in CockroachDB')`,
      [orderId, userId]
    );

    // 13. Clear the user's cart ONLY after all order records are created inside the transaction
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cart.id]);
    await client.query(
      `UPDATE carts SET branch_id = NULL, coupon_code = NULL, updated_at = now() WHERE id = $1`,
      [cart.id]
    );

    return await getOrderByIdForUser(orderId, userId, client);
  });
}

export async function getOrderByIdForUser(
  orderIdOrNumber: string,
  requestingUserId: string,
  clientParam?: DbClient,
  allowAdminBypass = false
) {
  const queryRunner = clientParam || pool;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    orderIdOrNumber
  );

  const orderRes = await queryRunner.query(
    `SELECT o.*,
            r.name AS restaurant_name, r.slug AS restaurant_slug, r.image_url AS restaurant_image,
            b.branch_name, b.locality AS branch_locality, b.address AS branch_address,
            p.id AS payment_id, p.is_simulated, p.simulation_reference, p.provider_note, p.paid_at
     FROM orders o
     INNER JOIN restaurants r ON r.id = o.restaurant_id
     INNER JOIN restaurant_branches b ON b.id = o.branch_id
     LEFT JOIN payments p ON p.order_id = o.id
     WHERE ${isUuid ? 'o.id = $1' : 'o.order_number = $1'}
     LIMIT 1`,
    [orderIdOrNumber]
  );

  if (orderRes.rowCount === 0) {
    const err: any = new Error('Order not found.');
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  const order = orderRes.rows[0];
  if (order.user_id !== requestingUserId && !allowAdminBypass) {
    const err: any = new Error('Access denied: You can only view your own orders.');
    err.statusCode = 403;
    err.code = 'ORDER_OWNERSHIP_VIOLATION';
    throw err;
  }

  const itemsRes = await queryRunner.query(
    `SELECT id, menu_item_id, item_name_snapshot, category_name_snapshot,
            is_veg_snapshot, image_url_snapshot, unit_price_snapshot, quantity, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [order.id]
  );

  const historyRes = await queryRunner.query(
    `SELECT id, previous_status, new_status, actor_id, actor_source, note, created_at
     FROM order_status_history
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [order.id]
  );

  const addressSnapshot =
    typeof order.delivery_address_snapshot === 'string'
      ? JSON.parse(order.delivery_address_snapshot)
      : order.delivery_address_snapshot;

  return {
    id: order.id,
    orderNumber: order.order_number,
    idempotencyKey: order.idempotency_key,
    userId: order.user_id,
    restaurantId: order.restaurant_id,
    restaurantName: order.restaurant_name,
    restaurantSlug: order.restaurant_slug,
    restaurantImage: order.restaurant_image,
    branchId: order.branch_id,
    branchName: order.branch_name,
    branchLocality: order.branch_locality,
    branchAddress: order.branch_address,
    subtotal: fromPaise(toPaise(order.subtotal)),
    taxAmount: fromPaise(toPaise(order.tax_amount)),
    deliveryFee: fromPaise(toPaise(order.delivery_fee)),
    packagingFee: fromPaise(toPaise(order.packaging_fee)),
    discountAmount: fromPaise(toPaise(order.discount_amount)),
    finalTotal: fromPaise(toPaise(order.final_total)),
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    paymentDetails: {
      paymentId: order.payment_id,
      method: order.payment_method,
      status: order.payment_status,
      isSimulated: Boolean(order.is_simulated),
      simulationReference: order.simulation_reference || null,
      providerNote:
        order.provider_note ||
        (order.payment_method === 'SIMULATED_ONLINE'
          ? 'SIMULATED ONLINE PAYMENT'
          : 'Cash on Delivery'),
      paidAt: order.paid_at,
    },
    orderStatus: order.order_status as OrderStatus,
    allowedNextStatuses: VALID_STATUS_TRANSITIONS[order.order_status as OrderStatus] || [],
    estimatedDeliveryTime: order.estimated_delivery_time,
    deliveryDistanceKm: Number(order.delivery_distance_km),
    specialNotes: order.special_notes || '',
    deliveryAddress: addressSnapshot,
    items: itemsRes.rows.map((r) => ({
      id: r.id,
      menuItemId: r.menu_item_id,
      name: r.item_name_snapshot,
      categoryName: r.category_name_snapshot,
      isVeg: Boolean(r.is_veg_snapshot),
      imageUrl: r.image_url_snapshot,
      unitPrice: fromPaise(toPaise(r.unit_price_snapshot)),
      quantity: Number(r.quantity),
      lineTotal: fromPaise(toPaise(r.line_total)),
    })),
    statusHistory: historyRes.rows.map((h) => ({
      id: h.id,
      previousStatus: h.previous_status,
      newStatus: h.new_status,
      actorId: h.actor_id,
      actorSource: h.actor_source,
      note: h.note,
      timestamp: h.created_at,
    })),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

export async function listOrdersForUser(userId: string) {
  const ordersRes = await pool.query(
    `SELECT o.id, o.order_number, o.subtotal, o.tax_amount, o.delivery_fee,
            o.packaging_fee, o.discount_amount, o.final_total,
            o.payment_method, o.payment_status, o.order_status,
            o.estimated_delivery_time, o.created_at,
            r.name AS restaurant_name, r.slug AS restaurant_slug, r.image_url AS restaurant_image,
            b.branch_name, b.locality AS branch_locality,
            (SELECT COUNT(*)::INT FROM order_items oi WHERE oi.order_id = o.id) AS item_types_count,
            (SELECT COALESCE(SUM(oi.quantity), 0)::INT FROM order_items oi WHERE oi.order_id = o.id) AS total_quantity
     FROM orders o
     INNER JOIN restaurants r ON r.id = o.restaurant_id
     INNER JOIN restaurant_branches b ON b.id = o.branch_id
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC`,
    [userId]
  );

  return ordersRes.rows.map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    restaurantName: o.restaurant_name,
    restaurantSlug: o.restaurant_slug,
    restaurantImage: o.restaurant_image,
    branchName: o.branch_name,
    branchLocality: o.branch_locality,
    finalTotal: fromPaise(toPaise(o.final_total)),
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    orderStatus: o.order_status,
    estimatedDeliveryTime: o.estimated_delivery_time,
    itemTypesCount: Number(o.item_types_count),
    totalQuantity: Number(o.total_quantity),
    createdAt: o.created_at,
  }));
}

export async function transitionOrderStatus(params: {
  orderId: string;
  newStatus: OrderStatus;
  actorId: string;
  actorSource: string;
  note?: string;
}) {
  const { orderId, newStatus, actorId, actorSource, note = '' } = params;

  return await executeInTransaction(async (client) => {
    const orderRes = await client.query(
      `SELECT id, user_id, order_status, payment_method, payment_status
       FROM orders
       WHERE id = $1
       LIMIT 1`,
      [orderId]
    );

    if (orderRes.rowCount === 0) {
      const err: any = new Error('Order not found.');
      err.statusCode = 404;
      err.code = 'ORDER_NOT_FOUND';
      throw err;
    }

    const order = orderRes.rows[0];
    const currentStatus = order.order_status as OrderStatus;
    const allowed = VALID_STATUS_TRANSITIONS[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
      const err: any = new Error(
        `Invalid order status transition from ${currentStatus} to ${newStatus}. Allowed transitions: ${
          allowed.join(', ') || 'None (terminal state)'
        }.`
      );
      err.statusCode = 400;
      err.code = 'INVALID_STATUS_TRANSITION';
      throw err;
    }

    // If COD order reaches DELIVERED, mark payment status as COLLECTED
    let updatedPaymentStatus = order.payment_status;
    if (newStatus === 'DELIVERED' && order.payment_method === 'COD') {
      updatedPaymentStatus = 'COLLECTED';
      await client.query(
        `UPDATE payments
         SET payment_status = 'COLLECTED', paid_at = now(), updated_at = now()
         WHERE order_id = $1`,
        [orderId]
      );
    } else if (newStatus === 'CANCELLED' && order.payment_status === 'SIMULATED_PAID') {
      updatedPaymentStatus = 'REFUNDED';
      await client.query(
        `UPDATE payments
         SET payment_status = 'REFUNDED', updated_at = now()
         WHERE order_id = $1`,
        [orderId]
      );
    }

    await client.query(
      `UPDATE orders
       SET order_status = $1, payment_status = $2, updated_at = now()
       WHERE id = $3`,
      [newStatus, updatedPaymentStatus, orderId]
    );

    await client.query(
      `INSERT INTO order_status_history (
         order_id, previous_status, new_status, actor_id, actor_source, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orderId,
        currentStatus,
        newStatus,
        actorId,
        actorSource,
        note || `Status transitioned from ${currentStatus} to ${newStatus}`,
      ]
    );

    return await getOrderByIdForUser(orderId, order.user_id, client, true);
  });
}
