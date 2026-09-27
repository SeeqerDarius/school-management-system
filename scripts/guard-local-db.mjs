#!/usr/bin/env node
/**
 * Refuses to run a destructive Prisma command against anything but a local database.
 *
 * `prisma migrate reset` and `prisma migrate dev` both DROP and recreate. Against a Supabase
 * project that does not merely delete this application's tables: it destroys the platform's own
 * auth and storage objects, their grants, policies and trigger functions, and the project does
 * not come back (prisma/prisma#16588).
 *
 * `db:reset` is a two-word script name a developer types reflexively at whatever they believe is
 * their local database. With a Supabase URL in .env that keystroke is an unrecoverable production
 * event against children's records, a ledger and payroll. Nothing else in the repository
 * distinguishes the two, so this does.
 *
 * `db:deploy` is deliberately not guarded — it only ever applies migrations forward.
 */

import { existsSync, readFileSync } from 'node:fs';

/**
 * Reads .env the way Prisma does, because this runs as its own process and Node does not load
 * .env by itself. A guard that cannot see the URL would refuse every time, and a guard that
 * cries wolf gets deleted.
 */
function readEnvFile(path) {
  if (!existsSync(path)) return {};

  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

// A real environment variable wins over the file, matching Prisma's own precedence.
const fromFile = readEnvFile('.env');
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? fromFile.DIRECT_URL ?? fromFile.DATABASE_URL ?? '';

let host = '';
try {
  host = new URL(url).hostname;
} catch {
  // An unparseable or absent URL is not a licence to proceed — fall through and refuse.
}

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

if (!LOCAL.has(host)) {
  console.error(
    `\nRefusing to run a destructive Prisma command against "${host || '<no usable DIRECT_URL>'}".\n\n` +
      'migrate dev and migrate reset DROP the database. Against Supabase that destroys the\n' +
      "project's auth and storage schemas too, and it does not recover.\n\n" +
      'Point DIRECT_URL at a local PostgreSQL to develop migrations, or use `npm run db:deploy`,\n' +
      'which only ever applies them forward.\n',
  );
  process.exit(1);
}
