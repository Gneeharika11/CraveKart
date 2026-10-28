import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import {
  getUserCart,
  addItemToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearUserCart,
  applyCartCoupon,
} from '../services/cartService.js';

export const cartRouter = Router();

const addItemSchema = z.object({
  branchId: z.string().uuid('Valid branchId UUID is required.'),
  menuItemId: z.string().uuid('Valid menuItemId UUID is required.'),
  quantity: z.number().int().min(1).max(50).default(1),
  specialInstructions: z.string().trim().max(250).optional().default(''),
  forceClear: z.boolean().optional().default(false),
});

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(0).max(50),
});

// GET /api/cart
cartRouter.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cart = await getUserCart(req.user!.id);
    res.json({ cart });
  } catch (err) {
    next(err);
  }
});

// POST /api/cart/items
cartRouter.post('/items', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = addItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Invalid cart item payload.',
      });
      return;
    }

    const cart = await addItemToCart({
      userId: req.user!.id,
      ...parsed.data,
    });

    res.status(200).json({
      message: 'Item added to cart.',
      cart,
    });
  } catch (err: any) {
    if (err?.code === 'CROSS_BRANCH_CONFLICT') {
      res.status(409).json({
        error: 'CROSS_BRANCH_CONFLICT',
        message: err.message,
        requiresConfirmation: true,
      });
      return;
    }
    next(err);
  }
});

// PATCH /api/cart/items/:id
cartRouter.patch(
  '/items/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = updateQuantitySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid quantity.',
        });
        return;
      }

      const cart = await updateCartItemQuantity({
        userId: req.user!.id,
        cartItemId: String(req.params.id || '').trim(),
        quantity: parsed.data.quantity,
      });

      res.json({
        message: 'Cart updated.',
        cart,
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/cart/items/:id
cartRouter.delete(
  '/items/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cart = await removeCartItem(req.user!.id, String(req.params.id || '').trim());
      res.json({
        message: 'Item removed from cart.',
        cart,
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/cart
cartRouter.delete('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cart = await clearUserCart(req.user!.id);
    res.json({
      message: 'Cart cleared.',
      cart,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/cart/coupon
cartRouter.post('/coupon', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const couponCode =
      typeof req.body?.couponCode === 'string' && req.body.couponCode.trim()
        ? req.body.couponCode.trim()
        : null;
    const cart = await applyCartCoupon(req.user!.id, couponCode);
    res.json({
      message: couponCode ? `Coupon ${couponCode.toUpperCase()} applied.` : 'Coupon removed.',
      cart,
    });
  } catch (err) {
    next(err);
  }
});
