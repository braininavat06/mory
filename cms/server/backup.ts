import { existsSync, mkdirSync, readdirSync, rmSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { publicationTime } from '../../src/lib/dates.ts';
import type { Store } from './store.ts';
export async function backup(store: Store, now = new Date()) {
  const dir = join(store.runtime, 'backups'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const day = publicationTime(now).slice(0, 10), target = join(dir, `${day}.sqlite`);
  if (!existsSync(target)) {
    const temporary = `${target}.partial`; rmSync(temporary, { force: true });
    await store.db.backup(temporary); chmodSync(temporary, 0o600); renameSync(temporary, target);
  }
  // Keep daily snapshots for 7 days and one per ISO-like 7-day bucket for 8 weeks.
  const keptWeeks = new Set<number>();
  const cutoff = Date.parse(`${day}T00:00:00Z`);
  for (const name of readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort().reverse()) {
    const age = Math.floor((cutoff - Date.parse(`${name.slice(0, 10)}T00:00:00Z`)) / 86400_000);
    if (age < 7) continue;
    const week = Math.floor(Date.parse(name.slice(0, 10)) / (7 * 86400_000));
    if (age <= 63 && !keptWeeks.has(week)) keptWeeks.add(week); else rmSync(join(dir, name));
  }
  return target;
}
