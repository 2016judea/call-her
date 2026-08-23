// The db contract, persisted to a JSON file. Enough to run the real bot on this
// laptop with no Postgres, so the loop can be exercised on real phones before
// any infrastructure exists.
//
// Dates survive the round trip: JSON turns them into strings, and the machine
// compares them, so they are revived on load.

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { memoryDb } from './memory-db.js';
import { revive, serialise } from '../lib/snapshot.js';

export function fileDb(path) {
  const seed = existsSync(path) ? revive(readFileSync(path, 'utf8')) : undefined;
  const db = memoryDb(seed);

  const save = () => {
    // Write-then-rename so a crash mid-write cannot truncate the store.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, serialise(db._tables));
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
