import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import {
  createSession,
  clearSession,
  requireAuth,
} from '../middleware/auth.js';

export const authRouter = Router();

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 500 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
});

const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Full name must be at least 2 characters long.')
      .max(120, 'Full name cannot exceed 120 characters.'),
    email: z
      .string()
      .trim()
      .email('Please enter a valid email address.')
      .transform((val) => val.toLowerCase()),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]{10,15}$/, 'Please enter a valid 10 to 15 digit phone number.'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long.')
      .max(100, 'Password cannot exceed 100 characters.')
      .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
      .regex(/[0-9]/, 'Password must contain at least one number.'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Please enter a valid email address.')
    .transform((val) => val.toLowerCase()),
  password: z.string().min(1, 'Password is required.'),
});

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{10,15}$/, 'Please enter a valid phone number.')
    .optional(),
});

// POST /api/auth/register
authRouter.post(
  '/register',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: firstIssue?.message || 'Invalid registration input.',
          details: parsed.error.issues,
        });
        return;
      }

      const { fullName, email, phone, password } = parsed.data;

      // Check for duplicate email
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
      if (existing.rowCount && existing.rowCount > 0) {
        res.status(409).json({
          error: 'DUPLICATE_EMAIL',
          message: 'An account with this email address already exists. Please log in instead.',
        });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const insertRes = await pool.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, 'CUSTOMER', true)
         RETURNING id, full_name, email, phone, role, created_at`,
        [fullName, email, phone, passwordHash]
      );

      const userRow = insertRes.rows[0];
      const sessionToken = await createSession(userRow.id, req, res);

      res.status(201).json({
        message: 'Registration successful! Welcome to CraveKart.',
        token: sessionToken,
        user: {
          id: userRow.id,
          fullName: userRow.full_name,
          email: userRow.email,
          phone: userRow.phone,
          role: userRow.role,
          createdAt: userRow.created_at,
        },
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        res.status(409).json({
          error: 'DUPLICATE_EMAIL',
          message: 'An account with this email address already exists.',
        });
        return;
      }
      next(err);
    }
  }
);

// POST /api/auth/login
authRouter.post(
  '/login',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Invalid login credentials format.',
        });
        return;
      }

      const { email, password } = parsed.data;

      const userRes = await pool.query(
        `SELECT id, full_name, email, phone, password_hash, role, is_active, created_at
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [email]
      );

      if (userRes.rowCount === 0) {
        res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email address or password.',
        });
        return;
      }

      const userRow = userRes.rows[0];
      if (!userRow.is_active) {
        res.status(403).json({
          error: 'ACCOUNT_DISABLED',
          message: 'This account has been deactivated.',
        });
        return;
      }

      const passwordValid = await bcrypt.compare(password, userRow.password_hash);
      if (!passwordValid) {
        res.status(401).json({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email address or password.',
        });
        return;
      }

      const sessionToken = await createSession(userRow.id, req, res);

      res.json({
        message: 'Logged in successfully.',
        token: sessionToken,
        user: {
          id: userRow.id,
          fullName: userRow.full_name,
          email: userRow.email,
          phone: userRow.phone,
          role: userRow.role,
          createdAt: userRow.created_at,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/auth/logout
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await clearSession(req, res);
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userRes = await pool.query(
      `SELECT id, full_name, email, phone, role, created_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.user!.id]
    );
    if (userRes.rowCount === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
      return;
    }
    const u = userRes.rows[0];
    res.json({
      user: {
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        createdAt: u.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/me
authRouter.patch('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Invalid profile update data.',
      });
      return;
    }

    const { fullName, phone } = parsed.data;
    const updRes = await pool.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           updated_at = now()
       WHERE id = $3
       RETURNING id, full_name, email, phone, role, created_at`,
      [fullName ?? null, phone ?? null, req.user!.id]
    );

    const u = updRes.rows[0];
    res.json({
      message: 'Profile updated successfully.',
      user: {
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        createdAt: u.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});
