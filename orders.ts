import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  placeOrderTransactionally,
  getOrderByIdForUser,
  listOrdersForUser,
  transitionOrderStatus,
  OrderStatus,
} from '../services/orderService.js';

export const ordersRouter = Router();

const placeOrderSchema = z.object({
  addressId: z.string().uuid('A valid saved delivery address must be selected.'),
  paymentMethod: z.enum(['COD', 'SIMULATED_ONLINE'], {
    errorMap: () => ({
      message: 'Payment method must be either COD (Cash on Delivery) or SIMULATED_ONLINE.',
    }),
  }),
  idempotencyKey: z.string().trim().min(4).max(120).optional(),
  specialNotes: z.string().trim().max(500).optional().default(''),
  simulateFailureAfterOrderInsert: z.boolean().optional().default(false),
});

const statusTransitionSchema = z.object({
  newStatus: z.enum([
    'CONFIRMED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
  ]),
  note: z.string().trim().max(250).optional(),
});

// POST /api/orders
ordersRouter.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Invalid order placement request.',
        details: parsed.error.issues,
      });
      return;
    }

    const headerIdempotency =
      typeof req.headers['x-idempotency-key'] === 'string'
        ? req.headers['x-idempotency-key']
        : undefined;

    const order = await placeOrderTransactionally({
      userId: req.user!.id,
      addressId: parsed.data.addressId,
      paymentMethod: parsed.data.paymentMethod,
      idempotencyKey: parsed.data.idempotencyKey || headerIdempotency,
      specialNotes: parsed.data.specialNotes,
      simulateFailureAfterOrderInsert:
        process.env.NODE_ENV === 'test' && parsed.data.simulateFailureAfterOrderInsert,
    });

    res.status(201).json({
      message: 'Order placed successfully!',
      order,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders
ordersRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orders = await listOrdersForUser(req.user!.id);
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

// GET /api/orders/:id
ordersRouter.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isAdminOrDev = req.user!.role === 'ADMIN' || req.user!.role === 'DEV';
    const order = await getOrderByIdForUser(
      String(req.params.id || '').trim(),
      req.user!.id,
      undefined,
      isAdminOrDev
    );
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/:id/advance-status
// Restricted to ADMIN/DEV accounts or explicit development-only simulator mode
ordersRouter.post(
  '/:id/advance-status',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isAdminOrDev = req.user!.role === 'ADMIN' || req.user!.role === 'DEV';
      const isDevSimulatorAllowed =
        process.env.DEV_TOOLS_ENABLED === 'true' &&
        req.headers['x-cravekart-dev-simulator'] === 'true';

      if (!isAdminOrDev && !isDevSimulatorAllowed) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message:
            'Ordinary users cannot arbitrarily modify order statuses. Use an Administrator/Developer account or the Dev Simulator controls.',
        });
        return;
      }

      const parsed = statusTransitionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid status transition request.',
        });
        return;
      }

      const order = await transitionOrderStatus({
        orderId: String(req.params.id || '').trim(),
        newStatus: parsed.data.newStatus as OrderStatus,
        actorId: req.user!.id,
        actorSource: isAdminOrDev ? `ROLE_${req.user!.role}` : 'DEV_STATUS_SIMULATOR',
        note: parsed.data.note,
      });

      res.json({
        message: `Order status updated to ${order.orderStatus}.`,
        order,
      });
    } catch (err) {
      next(err);
    }
  }
);
