// Minimal, dependency-free migration runner.
// Runs every file in server/migrations that exports { name, up } in filename order.
// Records completed migrations in the `_migrations` table.
// Every migration MUST be safe to run twice (check before create/alter).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const ensureTable = async () => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const applied = async () => {
  const rows = await sequelize.query('SELECT name FROM _migrations', { type: QueryTypes.SELECT });
  return new Set(rows.map((r) => r.name));
};

const listMigrations = () =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => ({ file: f, mod: require(path.join(MIGRATIONS_DIR, f)) }))
    .filter(({ mod }) => typeof mod.up === 'function' && mod.name);

const run = async () => {
  try {
    await sequelize.authenticate();
    await ensureTable();
    const done = await applied();
    const pending = listMigrations().filter(({ mod }) => !done.has(mod.name));

    if (pending.length === 0) {
      console.log('[migrate] nothing to do');
      return;
    }

    for (const { mod } of pending) {
      console.log(`[migrate] applying ${mod.name}`);
      await mod.up(sequelize.getQueryInterface(), sequelize.Sequelize.DataTypes);
      await sequelize.query('INSERT INTO _migrations (name) VALUES (:name)', {
        replacements: { name: mod.name },
      });
      console.log(`[migrate] applied  ${mod.name}`);
    }
  } catch (err) {
    console.error('[migrate] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

run();
