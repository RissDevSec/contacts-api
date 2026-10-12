#!/usr/bin/env node
/**
 * Apply the Prisma migrations to the TEST database (the one in .env.test).
 *
 * A plain `prisma migrate deploy` only reads .env, so it would migrate the real
 * database. This script reads .env.test instead, and refuses to continue unless
 * the target is clearly a test database (same rule as the integration tests).
 *
 *   npm run migrate:test
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const dotenv = require("dotenv");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env.test");

if (!fs.existsSync(envFile)) {
  console.error("Missing .env.test. Copy .env.test.example to .env.test and point it at your test database.");
  process.exit(1);
}

// Never overrides a variable that is already set in the shell.
dotenv.config({ path: envFile, quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set in .env.test.");
  process.exit(1);
}

const parsed = new URL(url);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

if (!/test/i.test(databaseName)) {
  console.error(
    `Refusing to migrate database "${databaseName}": the name must contain "test". ` +
      "Check .env.test and make sure DATABASE_URL is not already set to another database in your shell."
  );
  process.exit(1);
}

console.log(`Applying migrations to test database "${databaseName}" at ${parsed.host}`);

const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const result = spawnSync(
  process.execPath,
  [prismaCli, "migrate", "deploy", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env: process.env }
);

process.exit(result.status ?? 1);