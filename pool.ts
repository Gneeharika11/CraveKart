import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { Pool } = pg;

const isTest = process.env.NODE_ENV === 'test';
const connectionString = isTest
  ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
  : process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    'CRITICAL: DATABASE_URL is not configured. Please copy .env.example to backend/.env and configure your CockroachDB connection string.'
  );
}

const sslCertPath = process.env.COCKROACH_SSL_CERT_PATH?.trim();
const requiresSsl =
  Boolean(sslCertPath) ||
  connectionString?.includes('sslmode=verify-full') ||
  connectionString?.includes('sslmode=require') ||
  connectionString?.includes('cockroachlabs.cloud');

function buildSslConfig(): pg.PoolConfig['ssl'] {
  if (!requiresSsl) {
    return false;
  }
  if (sslCertPath && fs.existsSync(sslCertPath)) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(sslCertPath, 'utf-8'),
    };
  }
  return { rejectUnauthorized: true };
}

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: buildSslConfig(),
});

export type DbClient = pg.PoolClient;

/**
 * Executes a callback inside a CockroachDB SERIALIZABLE transaction with
 * automatic client-side retry handling for SQLSTATE 40001 (serialization_failure).
 * CockroachDB guarantees serializable isolation and may signal 40001 under contention.
 */
export async function executeInTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  maxRetries = 5
): Promise<T> {
  const client = await pool.connect();
  try {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        const isRetryable = err?.code === '40001';
        if (isRetryable && attempt <= maxRetries) {
          const backoffMs = Math.min(1000, Math.pow(2, attempt) * 25 + Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

export async function verifyCockroachConnection(): Promise<{
  connected: boolean;
  version: string;
  isCockroachDB: boolean;
}> {
  const res = await pool.query('SELECT version() AS version');
  const version: string = res.rows[0]?.version || '';
  const isCockroachDB = version.toLowerCase().includes('cockroachdb');
  return {
    connected: true,
    version,
    isCockroachDB,
  };
}
