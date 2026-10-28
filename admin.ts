import { Router, Request, Response, NextFunction } from 'express';
import { pool, verifyCockroachConnection } from '../db/pool.js';
import { requireAdminOrDev } from '../middleware/auth.js';
import { fromPaise, toPaise } from '../utils/money.js';

export const adminRouter = Router();

// GET /api/admin/db-stats
// Protected by server-side RBAC (requireAdminOrDev)
adminRouter.get(
  '/db-stats',
  requireAdminOrDev,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const dbInfo = await verifyCockroachConnection();

      const countsRes = await pool.query(`
        SELECT
          (SELECT COUNT(*)::INT FROM users) AS total_users,
          (SELECT COUNT(*)::INT FROM restaurants WHERE is_active = true) AS total_restaurants,
          (SELECT COUNT(*)::INT FROM restaurant_branches WHERE is_active = true) AS total_branches,
          (SELECT COUNT(*)::INT FROM food_categories WHERE is_active = true) AS total_categories,
          (SELECT COUNT(*)::INT FROM menu_items) AS total_menu_items,
          (SELECT COUNT(*)::INT FROM branch_menu_items) AS total_branch_menu_items,
          (SELECT COUNT(*)::INT FROM delivery_zones) AS total_delivery_zones,
          (SELECT COUNT(*)::INT FROM user_addresses) AS total_saved_addresses,
          (SELECT COUNT(*)::INT FROM orders) AS total_orders
      `);

      const statusRes = await pool.query(`
        SELECT order_status, COUNT(*)::INT AS count
        FROM orders
        GROUP BY order_status
        ORDER BY order_status ASC
      `);

      // Financial summary distinguishing placed orders vs cancelled orders
      // and recorded order totals vs actual collected/settled payments
      const financialsRes = await pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN order_status != 'CANCELLED' THEN final_total ELSE 0 END), 0) AS active_orders_gmv,
          COALESCE(SUM(CASE WHEN order_status = 'CANCELLED' THEN final_total ELSE 0 END), 0) AS cancelled_orders_value,
          COALESCE(SUM(CASE WHEN payment_status IN ('COLLECTED', 'SIMULATED_PAID') AND order_status != 'CANCELLED' THEN final_total ELSE 0 END), 0) AS settled_payments_total,
          COALESCE(SUM(CASE WHEN payment_status = 'PENDING' AND order_status != 'CANCELLED' THEN final_total ELSE 0 END), 0) AS pending_cod_total
        FROM orders
      `);

      const brandStatsRes = await pool.query(`
        SELECT r.id, r.name, r.cuisine, r.rating,
               COUNT(DISTINCT b.id)::INT AS branch_count,
               COUNT(DISTINCT m.id)::INT AS menu_item_count,
               COUNT(DISTINCT o.id)::INT AS order_count
        FROM restaurants r
        LEFT JOIN restaurant_branches b ON b.restaurant_id = r.id
        LEFT JOIN menu_items m ON m.restaurant_id = r.id
        LEFT JOIN orders o ON o.restaurant_id = r.id
        GROUP BY r.id, r.name, r.cuisine, r.rating
        ORDER BY r.name ASC
      `);

      const recentOrdersRes = await pool.query(`
        SELECT o.id, o.order_number, o.final_total, o.payment_method, o.payment_status,
               o.order_status, o.created_at,
               u.full_name AS customer_name, u.email AS customer_email,
               r.name AS restaurant_name, b.branch_name
        FROM orders o
        INNER JOIN users u ON u.id = o.user_id
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        INNER JOIN restaurant_branches b ON b.id = o.branch_id
        ORDER BY o.created_at DESC
        LIMIT 20
      `);

      const counts = countsRes.rows[0];
      const fin = financialsRes.rows[0];

      const ordersByStatusMap: Record<string, number> = {
        CONFIRMED: 0,
        PREPARING: 0,
        READY_FOR_PICKUP: 0,
        OUT_FOR_DELIVERY: 0,
        DELIVERED: 0,
        CANCELLED: 0,
      };
      for (const row of statusRes.rows) {
        ordersByStatusMap[row.order_status] = Number(row.count);
      }

      res.json({
        database: {
          engine: dbInfo.isCockroachDB ? 'CockroachDB Distributed SQL' : 'PostgreSQL Protocol Engine',
          version: dbInfo.version,
          isolationLevel: 'SERIALIZABLE',
        },
        totals: {
          users: Number(counts.total_users),
          restaurantBrands: Number(counts.total_restaurants),
          branches: Number(counts.total_branches),
          categories: Number(counts.total_categories),
          menuItems: Number(counts.total_menu_items),
          branchMenuItems: Number(counts.total_branch_menu_items),
          deliveryZones: Number(counts.total_delivery_zones),
          savedAddresses: Number(counts.total_saved_addresses),
          orders: Number(counts.total_orders),
        },
        ordersByStatus: ordersByStatusMap,
        financialSummary: {
          activeOrdersTotal: fromPaise(toPaise(fin.active_orders_gmv)),
          cancelledOrdersTotal: fromPaise(toPaise(fin.cancelled_orders_value)),
          settledPaymentsTotal: fromPaise(toPaise(fin.settled_payments_total)),
          pendingCodCollectionTotal: fromPaise(toPaise(fin.pending_cod_total)),
        },
        brandBreakdown: brandStatsRes.rows.map((b) => ({
          id: b.id,
          name: b.name,
          cuisine: b.cuisine,
          rating: Number(b.rating),
          branchCount: Number(b.branch_count),
          menuItemCount: Number(b.menu_item_count),
          orderCount: Number(b.order_count),
        })),
        recentOrders: recentOrdersRes.rows.map((o) => ({
          id: o.id,
          orderNumber: o.order_number,
          customerName: o.customer_name,
          customerEmail: o.customer_email,
          restaurantName: o.restaurant_name,
          branchName: o.branch_name,
          finalTotal: fromPaise(toPaise(o.final_total)),
          paymentMethod: o.payment_method,
          paymentStatus: o.payment_status,
          orderStatus: o.order_status,
          createdAt: o.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);
