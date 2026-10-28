import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { pool, verifyCockroachConnection } from './pool.js';

export async function runMigrations(targetPool: pg.Pool = pool): Promise<void> {
  const client = await targetPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const migrationsDir = path.resolve(process.cwd(), 'src/db/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [file]
      );
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      // Execute each DDL/DML statement sequentially in its own autocommit transaction
      // as required by CockroachDB online schema changes when an ALTER TABLE is followed by DML.
      const statements = sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await client.query(stmt);
      }
      if (existing.rowCount === 0) {
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
          [file]
        );
        console.log(`[CockroachDB Migrate] Applied migration: ${file}`);
      } else {
        console.log(`[CockroachDB Migrate] Verified migration (already applied): ${file}`);
      }
    }
  } finally {
    client.release();
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/migrate.ts');
if (isMain) {
  (async () => {
    try {
      const info = await verifyCockroachConnection();
      console.log(`[CockroachDB] Connected to: ${info.version}`);
      await runMigrations(pool);
      console.log('[CockroachDB] All migrations completed successfully.');
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('[CockroachDB Migrate Error]:', err);
      process.exit(1);
    }
  })();
}
