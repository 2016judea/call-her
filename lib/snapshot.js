// Serialising the whole dataset to JSON and back.
//
// JSON has no date type, and the machine compares dates (`post_at <= now`), so
// they must be revived on load or a held entry silently never comes due.

export const DATE_KEYS = new Set([
  'created_at', 'invited_at', 'joined_at', 'stopped_at',
  'post_at', 'posted_at', 'chase_at', 'chased_at', 'outcome_asked_at',
]);

const reviveRows = (rows = []) => rows.map((r) => {
  const out = { ...r };
  for (const k of DATE_KEYS) if (typeof out[k] === 'string') out[k] = new Date(out[k]);
  return out;
});

export const EMPTY = { users: [], circles: [], entries: [], log: [], seen: [] };

/** Parse a stored snapshot into a `memoryDb` seed. */
export function revive(raw) {
  if (!raw) return undefined;
  const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return {
    users: reviveRows(o.users), circles: reviveRows(o.circles),
    entries: reviveRows(o.entries),
    // The message log is append-only and unbounded; keep it bounded so the
    // snapshot cannot grow until a single write starts costing seconds.
    log: (o.log ?? []).slice(-500),
    // Ids of updates already acted on — see `haveSeen` in sim/memory-db.js.
    seen: (o.seen ?? []).slice(-400),
  };
}

export const serialise = (tables) => JSON.stringify(tables);
