// The db contract, persisted to a JSON file. Enough to run the real bot on this
// laptop with no Postgres, so the loop can be exercised on real phones before
// any infrastructure exists.
//
// Dates survive the round trip: JSON turns them into strings, and the machine
// compares them, so they are revived on load.

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { memoryDb } from './memory-db.js';

const DATE_KEYS = new Set([
  'created_at', 'invited_at', 'joined_at', 'stopped_at',
  'post_at', 'posted_at', 'chase_at', 'chased_at', 'outcome_asked_at',
]);

const revive = (rows = []) => rows.map((r) => {
  const out = { ...r };
  for (const k of DATE_KEYS) if (typeof out[k] === 'string') out[k] = new Date(out[k]);
  return out;
});

export function fileDb(path) {
  let seed;
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    seed = {
      users: revive(raw.users), circles: revive(raw.circles),
      entries: revive(raw.entries), log: raw.log ?? [],
    };
  }
  const db = memoryDb(seed);

  const save = () => {
    // Write-then-rename so a crash mid-write cannot truncate the store.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(db._tables, null, 2));
    renameSync(tmp, path);
  };

  // Persist after anything that could have mutated. Cheap at this scale, and
  // it means no call site has to remember to save.
  return new Proxy(db, {
    get(target, key) {
      const v = target[key];
      if (typeof v !== 'function') return v;
      return async (...args) => {
        const out = await v(...args);
        save();
        return out;
      };
    },
  });
}
