// The db.js contract, in memory. Same shape, same semantics, no Postgres.
// Used by the simulator and the integration tests.

import { S } from '../lib/machine.js';

export function memoryDb() {
  const users = [];
  const circles = [];
  const entries = [];
  const log = [];
  let uid = 0, cid = 0, eid = 0;

  const byPhone = (p) => users.find((u) => u.phone === p) ?? null;

  return {
    // exposed for assertions and the simulator's state dump
    _tables: { users, circles, entries, log },

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

    createEntry: async (userId, raw, clean) => {
      const e = { id: ++eid, author_id: userId, raw_body: raw, body: clean,
                  mode: null, outcome: null, created_at: new Date(),
                  post_at: null, posted_at: null, chase_at: null,
                  chased_at: null, outcome_asked_at: null };
      entries.push(e);
      return e;
    },
    openEntry: async (userId) =>
      [...entries].reverse().find((e) => e.author_id === userId &&
        (e.mode === null || (e.mode === 'wait' && e.posted_at === null))) ?? null,
    setEntryMode: async (id, mode, postAt, chaseAt) => {
      const e = entries.find((x) => x.id === id);
      Object.assign(e, { mode, post_at: postAt, chase_at: chaseAt });
    },
    setOutcome:       async (id, outcome) => { entries.find((e) => e.id === id).outcome = outcome; },
    markPosted:       async (id) => { entries.find((e) => e.id === id).posted_at = new Date(); },
    markChased:       async (id) => { entries.find((e) => e.id === id).chased_at = new Date(); },
    markOutcomeAsked: async (id) => { entries.find((e) => e.id === id).outcome_asked_at = new Date(); },

    duePosts: async (now) => entries.filter((e) =>
      !e.posted_at && e.post_at && e.post_at <= now && e.mode === 'wait'),
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

    logMessage: async (direction, peer, body) => { log.push({ direction, peer, body }); },
  };

  async function find(id) { return users.find((u) => u.id === id); }
}
