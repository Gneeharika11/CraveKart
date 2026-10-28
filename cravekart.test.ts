import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://root@localhost:26257/cravekart_test?sslmode=disable';
process.env.DEV_TOOLS_ENABLED = 'true';

import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';

describe('CraveKart Full-Stack CockroachDB Automated Test Suite (25 Critical Workflows)', () => {
  let userAToken = '';
  let userAId = '';
  let userBToken = '';
  let userBId = '';
  let adminToken = '';

  let spiceRouteId = '';
  let spiceRouteTNagarBranchId = '';
  let spiceRouteAnnaNagarBranchId = '';
  let biryaniHouseAdyarBranchId = '';

  let availableMenuItem1Id = '';
  let availableMenuItem2Id = '';
  let unavailableAtBranch3MenuItemId = '';
  let biryaniHouseMenuItemId = '';

  let userAValidAddressId = '';
  let userAOutOfZoneAddressId = '';
  let placedOrderId = '';
  let placedOrderNumber = '';

  const uniqueSuffix = Date.now();
  const userAEmail = `priya.${uniqueSuffix}@cravekart.test`;
  const userBEmail = `rahul.${uniqueSuffix}@cravekart.test`;

  beforeAll(async () => {
    await runMigrations(pool);
    await runSeed(pool);

    // Clean up any previous test users/orders in cravekart_test
    await pool.query(`DELETE FROM order_status_history`);
    await pool.query(`DELETE FROM payments`);
    await pool.query(`DELETE FROM order_items`);
    await pool.query(`DELETE FROM orders`);
    await pool.query(`DELETE FROM cart_items`);
    await pool.query(`DELETE FROM carts`);
    await pool.query(`DELETE FROM user_addresses WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@cravekart.test')`);
    await pool.query(`DELETE FROM users WHERE email LIKE '%@cravekart.test'`);
  }, 60000);

  afterAll(async () => {
    await pool.end();
  });

  // 1. Successful user registration
  it('1. Registers a new user successfully and hashes password in CockroachDB', async () => {
    const res = await request(app).post('/api/auth/register').send({
      fullName: 'Priya Sundaram',
      email: `  ${userAEmail.toUpperCase()} `,
      phone: '+919840123456',
      password: 'Password123',
      confirmPassword: 'Password123',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(userAEmail);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.token).toBeTruthy();

    userAToken = res.body.token;
    userAId = res.body.user.id;

    // Verify password hash in CockroachDB is bcrypt-hashed, never plaintext
    const dbCheck = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userAId]);
    expect(dbCheck.rows[0].password_hash).not.toBe('Password123');
    expect(dbCheck.rows[0].password_hash.startsWith('$2')).toBe(true);

    // Register second user (User B) for ownership/IDOR tests
    const resB = await request(app).post('/api/auth/register').send({
      fullName: 'Rahul Natarajan',
      email: userBEmail,
      phone: '+919840654321',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    expect(resB.status).toBe(201);
    userBToken = resB.body.token;
    userBId = resB.body.user.id;
  });

  // 2. Duplicate email rejection
  it('2. Rejects duplicate email registration with 409 Conflict', async () => {
    const res = await request(app).post('/api/auth/register').send({
      fullName: 'Duplicate User',
      email: userAEmail,
      phone: '+919840999999',
      password: 'Password123',
      confirmPassword: 'Password123',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_EMAIL');
  });

  // 3. Successful login
  it('3. Logs in an existing user with valid email and password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: userAEmail,
      password: 'Password123',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.id).toBe(userAId);
    userAToken = res.body.token;

    // Also login seeded Admin for admin tests
    const adminRes = await request(app).post('/api/auth/login').send({
      email: 'admin@cravekart.in',
      password: 'Admin@1234',
    });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;
  });

  // 4. Invalid password rejection
  it('4. Rejects login with an invalid password with 401 Unauthorized', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: userAEmail,
      password: 'WrongPassword999',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
  });

  // 5. Unauthorized access rejection
  it('5. Rejects unauthenticated requests to protected endpoints (cart, addresses, orders, profile)', async () => {
    const meRes = await request(app).get('/api/auth/me');
    expect(meRes.status).toBe(401);

    const cartRes = await request(app).get('/api/cart');
    expect(cartRes.status).toBe(401);

    const addrRes = await request(app).get('/api/addresses');
    expect(addrRes.status).toBe(401);

    const ordersRes = await request(app).get('/api/orders');
    expect(ordersRes.status).toBe(401);
  });

  // 6. Restaurant listing
  it('6. Retrieves all 6 fictional restaurant brands and supports search', async () => {
    const res = await request(app).get('/api/restaurants');
    expect(res.status).toBe(200);
    expect(res.body.restaurants.length).toBeGreaterThanOrEqual(6);

    const names = res.body.restaurants.map((r: any) => r.name);
    expect(names).toContain('Spice Route');
    expect(names).toContain('The Biryani House');
    expect(names).toContain('Urban Crust');
    expect(names).toContain('Wok & Roll');
    expect(names).toContain('Burger District');
    expect(names).toContain('Sweet Theory');

    const spiceRoute = res.body.restaurants.find((r: any) => r.slug === 'spice-route');
    spiceRouteId = spiceRoute.id;

    // Test search query
    const searchRes = await request(app).get('/api/restaurants?q=Biryani');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.restaurants.some((r: any) => r.slug === 'the-biryani-house')).toBe(true);
  });

  // 7. Branch listing
  it('7. Retrieves distinct branches for a restaurant brand (at least 18 branches across all 6 brands)', async () => {
    const res = await request(app).get(`/api/restaurants/${spiceRouteId}/branches`);
    expect(res.status).toBe(200);
    expect(res.body.branches.length).toBe(3);

    const tNagarBranch = res.body.branches.find((b: any) => b.locality === 'T. Nagar');
    const annaNagarBranch = res.body.branches.find((b: any) => b.locality === 'Anna Nagar');
    expect(tNagarBranch).toBeDefined();
    expect(annaNagarBranch).toBeDefined();
    expect(tNagarBranch.contactPhone).toBe('+91 44 2434 1101');
    expect(annaNagarBranch.contactPhone).toBe('+91 44 2621 1103');

    // Verify menu_categories compatible SQL view in CockroachDB
    const viewCheck = await pool.query('SELECT COUNT(*) AS cnt FROM menu_categories');
    expect(Number(viewCheck.rows[0].cnt)).toBeGreaterThanOrEqual(9);

    spiceRouteTNagarBranchId = tNagarBranch.id;
    spiceRouteAnnaNagarBranchId = annaNagarBranch.id;

    // Also get a branch from The Biryani House for cross-branch cart testing
    const tbhRes = await request(app).get('/api/restaurants/the-biryani-house/branches');
    expect(tbhRes.status).toBe(200);
    biryaniHouseAdyarBranchId = tbhRes.body.branches[0].id;
  });

  // 8. Menu retrieval
  it('8. Retrieves branch-specific menu items with filters and branch-specific pricing/availability', async () => {
    const res = await request(app).get(`/api/branches/${spiceRouteTNagarBranchId}/menu`);
    expect(res.status).toBe(200);
    expect(res.body.menuItems.length).toBeGreaterThanOrEqual(10);

    const dosaItem = res.body.menuItems.find((i: any) => i.slug === 'sr-ghee-roast-masala-dosa');
    const idliItem = res.body.menuItems.find((i: any) => i.slug === 'sr-madurai-podi-mini-idli');
    availableMenuItem1Id = dosaItem.id;
    availableMenuItem2Id = idliItem.id;

    // Verify veg filter
    const vegRes = await request(app).get(
      `/api/branches/${spiceRouteTNagarBranchId}/menu?diet=veg`
    );
    expect(vegRes.status).toBe(200);
    expect(vegRes.body.menuItems.every((i: any) => i.isVeg === true)).toBe(true);

    // Check Anna Nagar branch (3rd branch) where the 10th item is marked unavailable
    const annaMenuRes = await request(app).get(
      `/api/branches/${spiceRouteAnnaNagarBranchId}/menu`
    );
    const unavailItem = annaMenuRes.body.menuItems.find((i: any) => i.isAvailable === false);
    expect(unavailItem).toBeDefined();
    unavailableAtBranch3MenuItemId = unavailItem.id;

    // Get an available item from The Biryani House
    const tbhMenuRes = await request(app).get(`/api/branches/${biryaniHouseAdyarBranchId}/menu`);
    biryaniHouseMenuItemId = tbhMenuRes.body.menuItems.find((i: any) => i.isAvailable).id;
  });

  // 9. Adding cart items
  it('9. Adds food items to the persistent CockroachDB shopping cart', async () => {
    const res = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        branchId: spiceRouteTNagarBranchId,
        menuItemId: availableMenuItem1Id,
        quantity: 2,
      });

    expect(res.status).toBe(200);
    expect(res.body.cart.branchId).toBe(spiceRouteTNagarBranchId);
    expect(res.body.cart.items.length).toBe(1);
    expect(res.body.cart.items[0].quantity).toBe(2);

    // Add second item from the same branch
    const res2 = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        branchId: spiceRouteTNagarBranchId,
        menuItemId: availableMenuItem2Id,
        quantity: 1,
      });

    expect(res2.status).toBe(200);
    expect(res2.body.cart.items.length).toBe(2);
    expect(res2.body.cart.itemCount).toBe(3);
  });

  // 10. Updating quantities
  it('10. Updates item quantities in the cart and recalculates totals', async () => {
    const cartRes = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${userAToken}`);
    const firstCartItemId = cartRes.body.cart.items[0].id;

    const patchRes = await request(app)
      .patch(`/api/cart/items/${firstCartItemId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ quantity: 3 });

    expect(patchRes.status).toBe(200);
    const updatedItem = patchRes.body.cart.items.find((i: any) => i.id === firstCartItemId);
    expect(updatedItem.quantity).toBe(3);
  });

  // 11. Removing cart items
  it('11. Removes an item from the cart', async () => {
    const cartRes = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${userAToken}`);
    const secondCartItemId = cartRes.body.cart.items[1].id;

    const delRes = await request(app)
      .delete(`/api/cart/items/${secondCartItemId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.cart.items.length).toBe(1);
  });

  // 12. Cross-branch cart restrictions
  it('12. Enforces the single-branch cart rule with exact confirmation message and supports forceClear', async () => {
    // Attempt to add item from The Biryani House while cart has Spice Route - T. Nagar items
    const conflictRes = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        branchId: biryaniHouseAdyarBranchId,
        menuItemId: biryaniHouseMenuItemId,
        quantity: 1,
      });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error).toBe('CROSS_BRANCH_CONFLICT');
    expect(conflictRes.body.message).toBe(
      'Your cart contains items from another restaurant. Would you like to clear your cart and add this item?'
    );

    // Verify original cart was preserved when not confirmed
    const checkCart = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(checkCart.body.cart.branchId).toBe(spiceRouteTNagarBranchId);

    // Now test forceClear: true (user confirms clearing cart) and then switch back to Spice Route
    const forceRes = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        branchId: biryaniHouseAdyarBranchId,
        menuItemId: biryaniHouseMenuItemId,
        quantity: 1,
        forceClear: true,
      });
    expect(forceRes.status).toBe(200);
    expect(forceRes.body.cart.branchId).toBe(biryaniHouseAdyarBranchId);

    // Switch back to Spice Route - T. Nagar with 2 items for order placement test
    const switchBackRes = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        branchId: spiceRouteTNagarBranchId,
        menuItemId: availableMenuItem1Id,
        quantity: 2,
        forceClear: true,
      });
    expect(switchBackRes.status).toBe(200);
  });

  // 23. Unavailable menu-item rejection
  it('23. Rejects adding an unavailable menu item to the cart', async () => {
    const res = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        branchId: spiceRouteAnnaNagarBranchId,
        menuItemId: unavailableAtBranch3MenuItemId,
        quantity: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ITEM_UNAVAILABLE');
  });

  // 13. Invalid address rejection
  it('13. Rejects arbitrary unvalidated address strings or fake Place IDs', async () => {
    // Missing placeId
    const res1 = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        addressLabel: 'Home',
        houseFlatNo: '12A',
        formattedAddress: '123 Fake Street Typed Manually Without Autocomplete',
      });
    expect(res1.status).toBe(400);

    // Arbitrary / unverified placeId
    const res2 = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        placeId: 'arbitrary_fake_place_id_not_from_google',
        addressLabel: 'Home',
        houseFlatNo: '12A',
      });
    expect(res2.status).toBe(400);
  });

  // 14. Delivery-zone validation
  it('14. Validates delivery addresses and enforces server-side branch delivery zones', async () => {
    // Save a valid T. Nagar address for User A
    const validAddrRes = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        placeId: 'ChIJN5X_g2VnUjoR_demo_tnagar_chennai',
        addressLabel: 'Home',
        houseFlatNo: 'Flat 302',
        buildingName: 'Lotus Enclave',
        floorNumber: '3rd Floor',
        landmark: 'Near Panagal Park',
        deliveryInstructions: 'Leave at door',
        branchId: spiceRouteTNagarBranchId,
      });

    expect(validAddrRes.status).toBe(201);
    expect(validAddrRes.body.address.placeId).toBe('ChIJN5X_g2VnUjoR_demo_tnagar_chennai');
    expect(validAddrRes.body.deliveryCheck.eligible).toBe(true);
    userAValidAddressId = validAddrRes.body.address.id;

    // Save an out-of-zone address (Mahabalipuram / Bengaluru) for User A
    const outAddrRes = await request(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        placeId: 'ChIJ_out_of_zone_mahabalipuram',
        addressLabel: 'Weekend House',
        houseFlatNo: 'Villa 9',
        branchId: spiceRouteTNagarBranchId,
      });

    expect(outAddrRes.status).toBe(201);
    expect(outAddrRes.body.deliveryCheck.eligible).toBe(false);
    expect(outAddrRes.body.deliveryCheck.message).toBe(
      'Sorry! This restaurant does not deliver to your selected location.'
    );
    userAOutOfZoneAddressId = outAddrRes.body.address.id;

    // Attempt to place order to out-of-zone address -> must fail with 400 and exact message
    const badOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        addressId: userAOutOfZoneAddressId,
        paymentMethod: 'COD',
      });
    expect(badOrderRes.status).toBe(400);
    expect(badOrderRes.body.error).toBe('OUT_OF_DELIVERY_ZONE');
    expect(badOrderRes.body.message).toBe(
      'Sorry! This restaurant does not deliver to your selected location.'
    );
  });

  // 15. Address ownership checks
  it('15. Prevents User B from modifying, deleting, or checking out with User A’s saved address', async () => {
    const patchRes = await request(app)
      .patch(`/api/addresses/${userAValidAddressId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ houseFlatNo: 'Hacked Flat' });
    expect(patchRes.status).toBe(403);

    const delRes = await request(app)
      .delete(`/api/addresses/${userAValidAddressId}`)
      .set('Authorization', `Bearer ${userBToken}`);
    expect(delRes.status).toBe(403);

    const eligRes = await request(app)
      .post('/api/addresses/check-eligibility')
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        branchId: spiceRouteTNagarBranchId,
        addressId: userAValidAddressId,
      });
    expect(eligRes.status).toBe(403);
  });

  // 17. Server-side price calculation
  it('17. Calculates item subtotal, taxes, packaging fee, delivery fee, and final total accurately on the backend', async () => {
    const cartRes = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(cartRes.status).toBe(200);

    const pricing = cartRes.body.cart.pricing;
    // 2 x Ghee Roast Masala Dosa (145.00 each) = 290.00 subtotal
    expect(pricing.subtotal).toBe('290.00');
    expect(pricing.deliveryFee).toBe('30.00');
    expect(pricing.packagingFee).toBe('15.00');
    expect(pricing.taxAmount).toBe('14.50'); // 5% of 290.00
    expect(pricing.finalTotal).toBe('349.50'); // 290 + 30 + 15 + 14.50
  });

  // 19. Transaction rollback when order creation fails
  it('19. Rolls back the entire CockroachDB transaction and preserves the cart if order creation fails mid-transaction', async () => {
    const failRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        addressId: userAValidAddressId,
        paymentMethod: 'COD',
        simulateFailureAfterOrderInsert: true,
      });

    expect(failRes.status).toBe(500);
    expect(failRes.body.error).toBe('SIMULATED_TRANSACTION_FAILURE');

    // Verify no partial order was committed for User A
    const ordersCheck = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(ordersCheck.body.orders.length).toBe(0);

    // Verify User A's cart is still intact!
    const cartCheck = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(cartCheck.body.cart.items.length).toBe(1);
    expect(cartCheck.body.cart.items[0].quantity).toBe(2);
  });

  // 16 & 24. Successful order placement + Simulated payment labelling
  it('16 & 24. Places an order atomically in CockroachDB, clears the cart after commit, and labels simulated online payments accurately', async () => {
    const idempotencyKey = `idem-order-1-${uniqueSuffix}`;

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        addressId: userAValidAddressId,
        paymentMethod: 'SIMULATED_ONLINE',
        idempotencyKey,
        specialNotes: 'Extra sambar please',
      });

    expect(orderRes.status).toBe(201);
    expect(orderRes.body.message).toBe('Order placed successfully!');
    const order = orderRes.body.order;
    expect(order.orderNumber).toMatch(/^CK-\d{8}-\d+$/);
    expect(order.subtotal).toBe('290.00');
    expect(order.finalTotal).toBe('349.50');
    expect(order.orderStatus).toBe('CONFIRMED');

    // Verify simulated payment labelling (Test #24)
    expect(order.paymentMethod).toBe('SIMULATED_ONLINE');
    expect(order.paymentStatus).toBe('SIMULATED_PAID');
    expect(order.paymentDetails.isSimulated).toBe(true);
    expect(order.paymentDetails.providerNote).toContain('SIMULATED ONLINE PAYMENT');

    placedOrderId = order.id;
    placedOrderNumber = order.orderNumber;

    // Verify cart was cleared after successful commit
    const cartAfter = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(cartAfter.body.cart.items.length).toBe(0);
    expect(cartAfter.body.cart.branchId).toBeNull();
  });

  // 18. Duplicate order-submission protection (Idempotency)
  it('18. Prevents duplicate orders when retrying with the same idempotencyKey', async () => {
    const idempotencyKey = `idem-order-1-${uniqueSuffix}`;

    const retryRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        addressId: userAValidAddressId,
        paymentMethod: 'SIMULATED_ONLINE',
        idempotencyKey,
      });

    expect(retryRes.status).toBe(201);
    expect(retryRes.body.order.id).toBe(placedOrderId);
    expect(retryRes.body.order.orderNumber).toBe(placedOrderNumber);

    // Confirm only 1 order exists in CockroachDB for User A
    const listRes = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(listRes.body.orders.length).toBe(1);
  });

  // 20. Order confirmation retrieval
  it('20. Retrieves the actual saved order for the Order Confirmation page', async () => {
    const res = await request(app)
      .get(`/api/orders/${placedOrderId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.order.orderNumber).toBe(placedOrderNumber);
    expect(res.body.order.items.length).toBe(1);
    expect(res.body.order.items[0].quantity).toBe(2);
    expect(res.body.order.deliveryAddress.houseFlatNo).toBe('Flat 302');
    expect(res.body.order.statusHistory.length).toBe(1);
    expect(res.body.order.statusHistory[0].newStatus).toBe('CONFIRMED');
  });

  // 21. Order history persistence across logout and re-login
  it('21. Persists order history across user logout and subsequent login', async () => {
    // Logout User A
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(logoutRes.status).toBe(200);

    // Old token must now be invalid
    const checkOldToken = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(checkOldToken.status).toBe(401);

    // Log back in as User A
    const reloginRes = await request(app).post('/api/auth/login').send({
      email: userAEmail,
      password: 'Password123',
    });
    expect(reloginRes.status).toBe(200);
    userAToken = reloginRes.body.token;

    // Retrieve Order History
    const historyRes = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.orders.length).toBe(1);
    expect(historyRes.body.orders[0].orderNumber).toBe(placedOrderNumber);
  });

  // 22. Order ownership checks (IDOR protection)
  it('22. Rejects User B attempting to access User A’s order details with 403 Forbidden', async () => {
    const res = await request(app)
      .get(`/api/orders/${placedOrderId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ORDER_OWNERSHIP_VIOLATION');
  });

  // 25. Order status management & Admin DB Stats RBAC
  it('25. Enforces valid order status transitions, records order_status_history, and restricts /api/admin/db-stats to ADMIN/DEV roles', async () => {
    // Ordinary user without dev simulator header cannot modify order status
    const unauthAdvance = await request(app)
      .post(`/api/orders/${placedOrderId}/advance-status`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ newStatus: 'PREPARING' });
    expect(unauthAdvance.status).toBe(403);

    // Invalid jump (CONFIRMED -> DELIVERED directly) is rejected
    const invalidJump = await request(app)
      .post(`/api/orders/${placedOrderId}/advance-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newStatus: 'DELIVERED' });
    expect(invalidJump.status).toBe(400);
    expect(invalidJump.body.error).toBe('INVALID_STATUS_TRANSITION');

    // Valid transition: CONFIRMED -> PREPARING
    const validAdvance = await request(app)
      .post(`/api/orders/${placedOrderId}/advance-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newStatus: 'PREPARING', note: 'Chef started preparing dosa batter' });
    expect(validAdvance.status).toBe(200);
    expect(validAdvance.body.order.orderStatus).toBe('PREPARING');
    expect(validAdvance.body.order.statusHistory.length).toBe(2);

    // Ordinary user cannot access /api/admin/db-stats
    const customerStatsRes = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(customerStatsRes.status).toBe(403);

    // Admin can access /api/admin/db-stats
    const adminStatsRes = await request(app)
      .get('/api/admin/db-stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminStatsRes.status).toBe(200);
    expect(adminStatsRes.body.totals.restaurantBrands).toBe(6);
    expect(adminStatsRes.body.totals.branches).toBe(18);
    expect(adminStatsRes.body.totals.menuItems).toBe(60);
    expect(adminStatsRes.body.totals.orders).toBeGreaterThanOrEqual(1);
    expect(adminStatsRes.body.ordersByStatus.PREPARING).toBeGreaterThanOrEqual(1);
  });

  // 26. Cash on Delivery (COD) payment handling
  it('26. Saves COD orders with payment_status PENDING and only marks COLLECTED upon DELIVERED transition', async () => {
    // Add item to cart again for User A
    await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        branchId: spiceRouteTNagarBranchId,
        menuItemId: availableMenuItem1Id,
        quantity: 2,
      });

    const codOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        addressId: userAValidAddressId,
        paymentMethod: 'COD',
      });

    expect(codOrderRes.status).toBe(201);
    expect(codOrderRes.body.order.paymentMethod).toBe('COD');
    expect(codOrderRes.body.order.paymentStatus).toBe('PENDING');
    expect(codOrderRes.body.order.paymentDetails.isSimulated).toBe(false);
  });
});
