// The store's safety argument, with the network faked.
//
// Reads against Vercel Blob are occasionally flaky — a `get` on a document that
// definitely exists returned null once in six back-to-back reads (measured
// 2026-08-23). These pin that such a read cannot lose data, and that outbound
// messages are not sent twice when a commit retries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobStore } from '../lib/blob-db.js';

class FakePrecondition extends Error {
  constructor() { super('precondition failed'); this.name = 'BlobPreconditionFailedError'; }
}

/** A blob store in a variable, with the same preconditions the real one enforces. */
function fakeBlob({ nullReadsAtCall = [] } = {}) {
  let body = null, etag = null, version = 0, calls = 0;
  return {
    puts: 0,
    get calls() { return calls; },
    get body() { return body; },
    async get() {
      calls++;
      if (nullReadsAtCall.includes(calls)) return null;   // the flake
      if (body === null) return null;                      // genuinely absent
      return { statusCode: 200, stream: new Response(body).body, blob: { etag } };
    },
    async put(_p, data, opts) {
      this.puts++;
      if (opts.ifNoneMatch === '*' && body !== null) throw new FakePrecondition();
      if (opts.ifMatch && opts.ifMatch !== etag) throw new FakePrecondition();
      body = data; etag = `"v${++version}"`;
      return { pathname: _p };
    },
  };
}

const noop = { send: async () => {}, sayInRoom: async () => {},
               addToRoom: async () => {}, removeFromRoom: async () => {} };
const users = (io) => JSON.parse(io.body).users.map((u) => u.phone);

test('a spurious empty read cannot wipe existing data', async () => {
  // Read #2 — the one opening the second transaction — lies and says the
  // document is absent, though the first transaction definitely wrote it.
  const io2 = fakeBlob({ nullReadsAtCall: [2] });
  const s2 = blobStore({ io: io2 });
  await s2.transaction(async (db) => { await db.createUser('tg:1', 'aaaa'); }, noop);
  await s2.transaction(async (db) => { await db.createUser('tg:2', 'bbbb'); }, noop);

  assert.deepEqual(users(io2), ['tg:1', 'tg:2'],
    'the flaked read discarded the first user');
});

test('a conflicting commit retries rather than clobbering', async () => {
  const io = fakeBlob();
  const store = blobStore({ io });
  await store.transaction(async (db) => { await db.createUser('tg:1', 'aaaa'); }, noop);

  // Simulate another writer landing between our read and our commit.
  const realPut = io.put.bind(io);
  let interfered = false;
  io.put = async (p, data, opts) => {
    if (!interfered) {
      interfered = true;
      await realPut(p, JSON.stringify({ users: [{ id: 9, phone: 'tg:other' }],
        circles: [], entries: [], log: [], seen: [] }), { ifMatch: opts.ifMatch });
      throw new FakePrecondition();
    }
    return realPut(p, data, opts);
  };
  await store.transaction(async (db) => { await db.createUser('tg:2', 'bbbb'); }, noop);
  assert.ok(users(io).includes('tg:other'), "the other writer's row was clobbered");
  assert.ok(users(io).includes('tg:2'), 'our own row was lost');
});

test('outbound messages are not sent twice when a commit retries', async () => {
  const io = fakeBlob();
  const store = blobStore({ io });
  const sent = [];
  const channel = { ...noop, send: async (to, body) => sent.push([to, body]) };

  let thrown = false;
  const realPut = io.put.bind(io);
  io.put = async (p, d, o) => {
    if (!thrown) { thrown = true; throw new FakePrecondition(); }
    return realPut(p, d, o);
  };

  await store.transaction(async (db, ch) => {
    await db.createUser('tg:1', 'aaaa');
    await ch.send('tg:1', 'hello');
  }, channel);

  assert.equal(sent.length, 1, `the retry re-sent: ${JSON.stringify(sent)}`);
});

test('nothing is delivered if every attempt fails', async () => {
  const io = fakeBlob();
  io.put = async () => { throw new FakePrecondition(); };
  const sent = [];
  const store = blobStore({ io });
  await assert.rejects(() => store.transaction(
    async (db, ch) => { await ch.send('tg:1', 'hello'); },
    { ...noop, send: async (t, b) => sent.push([t, b]) }));
  assert.deepEqual(sent, [], 'messages escaped a transaction that never committed');
});
