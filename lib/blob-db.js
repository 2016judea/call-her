// The whole dataset as one JSON document in Vercel Blob, with the request's
// work wrapped in an optimistic transaction.
//
// Why this rather than Postgres: the data is a few kilobytes, the write rate is
// a few per person per week, and Vercel Blob is included on Pro and needs no
// provisioning, no connection pooling and no cold-start wake. Redis and
// Postgres are both Marketplace integrations now and cannot be created from the
// API (`redis` -> not_found, `postgres` -> gone, checked 2026-08-23).
//
// Why it is safe: Blob supports conditional writes (`ifMatch` on an ETag), so a
// commit that raced another one fails rather than clobbering it, and we retry
// against fresh state. Outbound messages are BUFFERED until the commit lands —
// without that, a retry would text everyone twice.
//
// lib/db.js (Postgres) still implements the same contract. Swapping back is one
// import in api/*.js.

import { put, head, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { memoryDb } from '../sim/memory-db.js';
import { revive, serialise, EMPTY } from './snapshot.js';

const MAX_ATTEMPTS = 5;

export function blobStore({ pathname = 'call-her/store.json', token } = {}) {
  const opts = token ? { token } : {};

  async function read() {
    try {
      const meta = await head(pathname, opts);
      const res = await fetch(meta.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`blob read ${res.status}`);
      return { data: revive(await res.json()), etag: meta.etag };
    } catch (err) {
      // First run: nothing stored yet. Match the exported class, not the
      // message — the SDK says "does not exist", which no /not found/ test hits.
      if (err instanceof BlobNotFoundError) return { data: undefined, etag: undefined };
      throw err;
    }
  }

  async function write(tables, etag) {
    await put(pathname, serialise(tables), {
      ...opts,
      access: 'public',            // unguessable URL; never linked anywhere
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      // The write only lands if nothing else committed since we read.
      ...(etag ? { ifMatch: etag } : { ifNoneMatch: '*' }),
    });
  }

  const isConflict = (e) => e instanceof BlobPreconditionFailedError;

  /**
   * Run one request's work atomically.
   *
   * @param {(db, channel) => Promise<any>} fn receives the store and a channel
   *   whose sends are held until the commit succeeds.
   * @param {object} channel the real channel to flush through.
   */
  async function transaction(fn, channel) {
    let lastConflict;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data, etag } = await read();
      const db = memoryDb(data ?? structuredClone(EMPTY));

      // Buffer everything outbound. A retry re-runs fn, and re-sending is worse
      // than any conflict we are protecting against.
      const outbox = [];
      const buffered = {
        ...channel,
        send: async (to, body) => { outbox.push(['send', to, body]); },
        sayInRoom: async (sid, body) => { outbox.push(['sayInRoom', sid, body]); },
        addToRoom: async (sid, id) => { outbox.push(['addToRoom', sid, id]); },
        removeFromRoom: async (sid, id) => { outbox.push(['removeFromRoom', sid, id]); },
        // createRoom must NOT be buffered: its return value is written to the
        // record inside the transaction.
      };

      const out = await fn(db, buffered);

      try {
        await write(db._tables, etag);
      } catch (err) {
        if (isConflict(err) && attempt < MAX_ATTEMPTS - 1) { lastConflict = err; continue; }
        throw err;
      }

      for (const [method, a, b] of outbox) await channel[method](a, b);
      return out;
    }
    throw lastConflict ?? new Error('blob transaction: out of attempts');
  }

  return { transaction, read, write };
}
