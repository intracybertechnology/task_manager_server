// Dumps the working database to a timestamped .sql file using the app's own
// connection settings. No password prompt: credentials come from server/.env.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const outDir = path.join(__dirname, '..', '..', 'backups');
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(outDir, `task_management-${stamp}.sql`);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set in server/.env');
  process.exit(1);
}

// pg_dump lives next to the Postgres install; find it on Windows or PATH.
const candidates = [
  ...(fs.existsSync('C:/Program Files/PostgreSQL')
    ? fs.readdirSync('C:/Program Files/PostgreSQL').map((v) => `C:/Program Files/PostgreSQL/${v}/bin/pg_dump.exe`)
    : []),
  'pg_dump',
];
const pgDump = candidates.find((c) => c === 'pg_dump' || fs.existsSync(c));

try {
  const parsed = new URL(url);
  const env = { ...process.env };
  // Pass the password to pg_dump explicitly so it never prompts (and never hangs).
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  parsed.password = '';
  const urlWithoutPassword = parsed.toString();

  execFileSync(pgDump, [urlWithoutPassword, '--no-owner', '--no-privileges', '--file', outFile], {
    stdio: 'inherit',
    env,
  });
} catch (err) {
  console.error('pg_dump failed:', err.message);
  process.exit(1);
}

const size = fs.statSync(outFile).size;
console.log(`Backup written: ${outFile}`);
console.log(`Size: ${(size / 1024).toFixed(1)} KB`);
if (size === 0) {
  console.error('Backup file is empty — treat this as a failure.');
  process.exit(1);
}
