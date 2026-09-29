import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pool } from '../lib/db.js';

function findMigrationsDir(): string {
  const candidates = [
    join(process.cwd(), '..', '..', 'migrations'), // apps/api -> repo root
    join(process.cwd(), 'migrations'),
    join('/app', 'migrations'), // Dockerfile layout
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error('migrations directory not found');
}

async function main() {
  const migDir = findMigrationsDir();
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await pool.query(`SELECT 1 FROM _migrations WHERE name = $1`, [f]);
    if (done.rowCount) {
      console.log(`skip ${f}`);
      continue;
    }
    console.log(`apply ${f}`);
    const sql = readFileSync(join(migDir, f), 'utf8');
    await pool.query(sql);
    await pool.query(`INSERT INTO _migrations (name) VALUES ($1)`, [f]);
  }
  console.log('migrations done');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
