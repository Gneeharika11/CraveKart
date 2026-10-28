import { app } from './app.js';
import { verifyCockroachConnection } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';

const PORT = Number(process.env.PORT || 4000);

async function startServer() {
  try {
    const dbInfo = await verifyCockroachConnection();
    console.log(`[CraveKart] Connected to primary database: ${dbInfo.version}`);

    await runMigrations();
    await runSeed();

    app.listen(PORT, () => {
      console.log(`[CraveKart] Backend API server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error(
      '[CraveKart Startup Error] Could not connect to CockroachDB. Please check DATABASE_URL in backend/.env.',
      err
    );
    process.exit(1);
  }
}

startServer();
