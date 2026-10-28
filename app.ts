import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { verifyCockroachConnection } from './db/pool.js';
import { restaurantsRouter } from './routes/restaurants.js';
import { authRouter } from './routes/auth.js';
import { addressesRouter } from './routes/addresses.js';
import { cartRouter } from './routes/cart.js';
import { ordersRouter } from './routes/orders.js';
import { adminRouter } from './routes/admin.js';

export const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = [
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Health check endpoint verifying live CockroachDB connectivity
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const db = await verifyCockroachConnection();
    res.json({
      status: 'ok',
      service: 'CraveKart Backend API',
      database: db,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'error',
      message:
        'CockroachDB database connection failed. Please verify DATABASE_URL in backend/.env.',
      details: process.env.NODE_ENV === 'development' ? err?.message : undefined,
    });
  }
});

// Mount API routes
app.use('/api', restaurantsRouter);
app.use('/api/auth', authRouter);
app.use('/api/addresses', addressesRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);

// 404 Handler for unknown API endpoints
app.use('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'The requested API endpoint does not exist.',
  });
});

// Safe centralized error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode =
    typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 500;
  const errorCode = err?.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';
  const message =
    statusCode < 500
      ? err.message
      : err?.code === 'SIMULATED_TRANSACTION_FAILURE'
      ? err.message
      : 'An unexpected server error occurred. Please try again.';

  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    console.error('[CraveKart Server Error]:', err);
  }

  res.status(statusCode).json({
    error: errorCode,
    message,
  });
});
