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

import { put, get, BlobPreconditionFailedError } from '@vercel/blob';
import { memoryDb } from '../sim/memory-db.js';
import { revive, serialise, EMPTY } from './snapshot.js';

const MAX_ATTEMPTS = 5;

export function blobStore({ pathname = 'call-her/store.json', token, io } = {}) {
  const opts = token ? { token } : {};
  // Injectable so the failure modes below can be tested without a network.
  const blob = io ?? { put, get };

  async function read() {
    // `useCache: false` is load-bearing, not a precaution. A public blob is
    // served from the CDN with `cache-control: public, max-age=60` — the
    // cacheControlMaxAge option cannot go below that — so reading through the
    // URL returned stale content for up to a minute (observed: x-cache HIT,
    // age 24, showing pre-write state). Stale reads could not corrupt anything,
    // because the ETag they carry fails the ifMatch on commit — but every retry
    // re-read the same cached copy, so two messages inside the same minute
    // could exhaust all attempts and fail outright.
    //
    // get() also returns the etag alongside the bytes it just read, so the
    // content and the ETag guarding it can never come from different versions —
    // which a separate head() + fetch() could not guarantee.
    const found = await blob.get(pathname, { ...opts, access: 'public', useCache: false });
    if (!found) return { data: undefined, etag: undefined };   // first run
    const text = await new Response(found.stream).text();
    return { data: revive(text), etag: found.blob.etag };
  }

  async function write(tables, etag) {
    await blob.put(pathname, serialise(tables), {
      ...opts,
      access: 'public',            // unguessable URL; never linked anywhere
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      // Floors at 60s regardless of what is asked for; reads bypass the CDN
      // entirely (see read()), so this only affects anyone fetching the URL.
      cacheControlMaxAge: 0,
      // The write only lands if nothing else committed since we read.
      ...(etag ? { ifMatch: etag } : { ifNoneMatch: '*' }),
    });
  }

  const isConflict = (e) => e instanceof BlobPreconditionFailedError ||
    e?.name === 'BlobPreconditionFailedError';

  // Reads are occasionally flaky: a `get` against a document that definitely
  // exists has been observed returning null (measured 2026-08-23, one in six
  // back-to-back reads). That CANNOT corrupt anything, and the reason is worth
  // stating because it is the whole safety argument for this store:
  //
  //   a null read yields no etag -> the commit uses ifNoneMatch:'*' -> the
  //   document already exists -> precondition fails -> we retry against a
  //   fresh read, and the existing data is untouched.
  //
  // So the CAS is not just protecting against concurrent writers; it is what
  // makes an unreliable read safe. test/blob-store.test.js pins it.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        if (isConflict(err) && attempt < MAX_ATTEMPTS - 1) {
          lastConflict = err;
          // Back off a little: an immediate re-read tends to get the same
          // stale or empty answer that caused the conflict.
          await sleep(60 * (attempt + 1));
          continue;
        }
        throw err;
      }

      for (const [method, a, b] of outbox) await channel[method](a, b);
      return out;
    }
    throw lastConflict ?? new Error('blob transaction: out of attempts');
  }

  return { transaction, read, write };
}
