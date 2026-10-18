import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { State } from './domain.js';

const path = process.env.AOM_DB_PATH || './data/aom.sqlite';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
const fresh = (): State => ({ run_id: randomUUID(), intents: [], batch: null, events: [] });
db.prepare('INSERT OR IGNORE INTO state VALUES(1, ?)').run(JSON.stringify(fresh()));
export function read(): State { return JSON.parse((db.prepare('SELECT value FROM state WHERE id=1').get() as { value: string }).value); }
export function update<T>(fn: (state: State) => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const state = read(); const result = fn(state); db.prepare('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state)); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function event(state: State, actor: string, action: string, detail: string) {
  state.events.push({ id: (state.events.at(-1)?.id || 0) + 1, at: new Date().toISOString(), actor, action, detail });
  if (state.events.length > 150) state.events = state.events.slice(-150);
}
export function reset() { return update(s => { if (s.batch?.status === 'paying' || s.batch?.notification.status === 'sending') throw new Error('Cannot reset while payments or the company notification are in progress.'); Object.assign(s, fresh()); event(s, 'operator', 'reset', 'New demo run. Previous sandbox payments are retained in Stripe.'); return s; }); }
