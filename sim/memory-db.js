// The db.js contract, in memory. Same shape, same semantics, no Postgres.
// Used by the simulator and the integration tests.

import { S } from '../lib/machine.js';

/**
 * @param {object} [seed] a previous `_tables` snapshot to restore. Id counters
 *   are derived from it, so restored rows can never collide with new ones.
 */
export function memoryDb(seed) {
  const users   = seed?.users   ?? [];
  const circles = seed?.circles ?? [];
  const entries = seed?.entries ?? [];
  const log     = seed?.log     ?? [];
  const seen    = seed?.seen    ?? [];
  const high = (rows) => rows.reduce((m, r) => Math.max(m, r.id ?? 0), 0);
  let uid = high(users), cid = high(circles), eid = high(entries);

  const byPhone = (p) => users.find((u) => u.phone === p) ?? null;

  return {
    // exposed for assertions and the simulator's state dump
    _tables: { users, circles, entries, log, seen },

    findUserByPhone: async (phone) => byPhone(phone),
    findUserByCode:  async (code) =>
      users.find((u) => u.join_code === code && !u.stopped_at) ?? null,
    findUserById:    async (id) => users.find((u) => u.id === id) ?? null,

    createUser: async (phone, joinCode) => {
      const existing = byPhone(phone);
      if (existing) return existing;
      const u = { id: ++uid, phone, handle: null, join_code: joinCode,
                  state: S.AWAITING_HANDLE, conversation_sid: null,
                  stopped_at: null, created_at: new Date() };
      users.push(u);
      return u;
    },
    setHandle:       async (id, handle) => { (await find(id)).handle = handle; },
    setState:        async (id, state)  => { (await find(id)).state = state; },
    setConversation: async (id, sid)    => { (await find(id)).conversation_sid = sid; },

    findPendingInvite: async (phone) =>
      [...circles].reverse().find((c) => c.phone === phone && c.status === 'pending') ?? null,
    activeCircle: async (ownerId) =>
      circles.filter((c) => c.owner_id === ownerId && c.status === 'active'),
    countActiveCircle: async (ownerId) =>
      circles.filter((c) => c.owner_id === ownerId && c.status === 'active').length,
    circleMembershipsOf: async (phone) =>
      circles.filter((c) => c.phone === phone && c.status === 'active')
             .map((c) => c.owner_id),

    createInvite: async (ownerId, phone) => {
      const hit = circles.find((c) => c.owner_id === ownerId && c.phone === phone);
      if (hit) { hit.status = 'pending'; hit.invited_at = new Date(); return hit; }
      const c = { id: ++cid, owner_id: ownerId, phone, name: null,
                  status: 'pending', invited_at: new Date(), joined_at: null };
      circles.push(c);
      return c;
    },
    activateInvite: async (ownerId, phone) => {
      const c = circles.find((x) => x.owner_id === ownerId && x.phone === phone);
      if (c) { c.status = 'active'; c.joined_at = new Date(); }
    },
    declineInvite: async (ownerId, phone) => {
      const c = circles.find((x) => x.owner_id === ownerId && x.phone === phone);
      if (c) c.status = 'removed';
    },

    // NOTE: created_at / posted_at / chased_at are stamped from the real wall
    // clock, not from the engine's injected `now`. Under a jumped clock they
    // are therefore wrong, so the machine must never make a decision or print
    // a date from one of them — use the columns the machine itself wrote
    // (post_at, chase_at). Reading created_at here cost a defect on 2026-08-23.
    createEntry: async (userId, raw, clean, postAt, chaseAt) => {
      const e = { id: ++eid, author_id: userId, raw_body: raw, body: clean,
                  mode: null, outcome: null, created_at: new Date(),
                  post_at: postAt ?? null, posted_at: null,
                  chase_at: chaseAt ?? null,
                  chased_at: null, outcome_asked_at: null };
      entries.push(e);
      return e;
    },
    openEntry: async (userId) =>
      [...entries].reverse().find((e) => e.author_id === userId &&
        (e.mode === null ||
         (e.outcome_asked_at !== null && e.outcome === null))) ?? null,
    setEntryMode: async (id, mode) => {
      entries.find((x) => x.id === id).mode = mode;
    },
    setOutcome:       async (id, outcome) => { entries.find((e) => e.id === id).outcome = outcome; },
    markPosted:       async (id) => { entries.find((e) => e.id === id).posted_at = new Date(); },
    markChased:       async (id) => { entries.find((e) => e.id === id).chased_at = new Date(); },
    markOutcomeAsked: async (id) => { entries.find((e) => e.id === id).outcome_asked_at = new Date(); },

    // Only ever an entry whose NOW-or-WAIT question was never answered:
    // choosing a mode posts it on the spot.
    duePosts: async (now) => entries.filter((e) =>
      !e.posted_at && e.mode === null && e.post_at && e.post_at <= now),
    dueChases: async (now) => entries.filter((e) =>
      !e.chased_at && e.chase_at && e.chase_at <= now && e.posted_at),

    stop: async (phone) => {
      const u = byPhone(phone);
      if (u) { u.stopped_at = new Date(); u.state = S.STOPPED; }
      for (const c of circles) if (c.phone === phone) c.status = 'removed';
    },
    restart: async (phone) => {
      const u = byPhone(phone);
      if (u) { u.stopped_at = null; u.state = S.AWAITING_HANDLE; }
    },

    findOwnerByRoom: async (sid) =>
      users.find((u) => u.conversation_sid === sid) ?? null,
    releaseRoom: async (sid) => {
      for (const u of users.filter((x) => x.conversation_sid === sid)) {
        u.conversation_sid = null;
        u.state = S.BUILDING_CIRCLE;
        for (const c of circles) {
          if (c.owner_id === u.id && c.phone === `tgroup:${sid}`) c.status = 'removed';
        }
      }
    },

    /**
     * Telegram is at-least-once: any update that does not get a 200 is retried,
     * so a platform timeout mid-handler would otherwise post a second entry or
     * send a second text. Recorded inside the same transaction as the work, so
     * the mark and the effect commit together or not at all.
     */
    haveSeenUpdate: async (id) => seen.includes(id),
    recordUpdate: async (id) => {
      seen.push(id);
      if (seen.length > 400) seen.splice(0, seen.length - 400);
    },

    logMessage: async (direction, peer, body) => { log.push({ direction, peer, body }); },
  };

  async function find(id) { return users.find((u) => u.id === id); }
}
