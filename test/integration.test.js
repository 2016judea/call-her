// End-to-end over lib/engine.js with an in-memory store and a recording
// channel. These cover what the pure-machine tests structurally cannot:
// ordering between the room and its members, state that drifts over time,
// and who actually received which bytes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from '../sim/memory-db.js';
import { consoleChannel } from '../sim/console-channel.js';
import { createEngine } from '../lib/engine.js';
import { S } from '../lib/machine.js';

const ME = '+16125550111', MIKE = '+16125550222', SAM = '+16125550333';

function rig() {
  const db = memoryDb();
  const channel = consoleChannel({ quiet: true });
  let clock = new Date('2026-08-23T23:42:00-05:00');
  const scrub = async (body) => ({ clean: body, removedNames: [], explicit: false });
  const engine = createEngine({ db, channel, scrub, now: () => new Date(clock) });
  return {
    db, channel, engine,
    text: (from, body) => engine.inbound(from, body),
    jump: async (days) => {
      clock = new Date(clock.getTime() + days * 86400000);
      return engine.tick();
    },
    code: () => db._tables.users[0].join_code,
    toldTo: (p) => channel._sent.filter((m) => m.to === p).map((m) => m.body),
    inRoom: () => channel._said.map((m) => m.body),
    members: () => [...(channel._rooms.values().next().value?.members ?? [])],
    me: () => db._tables.users.find((u) => u.phone === ME),
  };
}

async function onboarded(r) {
  await r.text(ME, 'what is this');
  await r.text(ME, 'Aidan');
  await r.text(MIKE, `join ${r.code()}`);
  await r.text(MIKE, 'yes');
  return r;
}

test('the room is greeted only once someone is in it to read the greeting', async () => {
  const r = await onboarded(rig());
  const intro = r.inRoom().findIndex((b) => /This is Aidan's circle/.test(b));
  assert.notEqual(intro, -1, 'the room was never introduced');
  // The greeting is addressed to the circle, so the circle must exist first.
  assert.ok(r.members().includes(MIKE), 'the member was not in the room');
  assert.equal(r.inRoom().length, 1, 'only the greeting should have been posted');
});

test('the room is greeted exactly once, not on every join', async () => {
  const r = await onboarded(rig());
  await r.text(SAM, `join ${r.code()}`);
  await r.text(SAM, 'yes');
  const intros = r.inRoom().filter((b) => /This is Aidan's circle/.test(b));
  assert.equal(intros.length, 1);
});

test('a circle that drains to zero blocks posting again', async () => {
  // The bug this pins: "ready" is earned once, but every member can leave.
  const r = await onboarded(rig());
  assert.equal(r.me().state, S.READY);

  await r.text(MIKE, 'STOP');
  await r.text(ME, 'Coffee at Spyhouse, talked three hours, it went really well');

  assert.equal(r.inRoom().length, 1, 'nothing may be posted into an empty room');
  assert.equal(r.db._tables.entries.length, 0, 'and no entry may be banked');
  assert.equal(r.me().state, S.BUILDING_CIRCLE, 'they should be sent back to recruiting');
  assert.match(r.toldTo(ME).at(-1), /nobody in your circle yet/);
});

test('a re-joined circle makes them ready again', async () => {
  const r = await onboarded(rig());
  await r.text(MIKE, 'STOP');
  await r.text(ME, 'Coffee at Spyhouse, talked three hours, it went really well');
  await r.text(SAM, `join ${r.code()}`);
  await r.text(SAM, 'yes');
  assert.equal(r.me().state, S.READY);
});

test('a held entry reaches nobody before its week is up', async () => {
  const r = await onboarded(rig());
  await r.text(ME, 'Drinks at Marvel Bar with the girl from the run club, good chemistry');
  await r.text(ME, 'wait');

  const before = r.inRoom().length;
  await r.jump(6);
  assert.equal(r.inRoom().length, before, 'a held entry leaked early');

  await r.jump(1);
  assert.match(r.toldTo(ME).at(-1), /what happened/);
  assert.equal(r.inRoom().length, before, 'it must still wait on the outcome');

  await r.text(ME, 'Called her Thursday.');
  const posted = r.inRoom().at(-1);
  assert.match(posted, /Marvel Bar/);
  assert.match(posted, /Called her Thursday/);
});

test('the daily pass is idempotent — a second run posts and chases nothing', async () => {
  const r = await onboarded(rig());
  await r.text(ME, 'Coffee at Spyhouse, talked three hours, it went really well');
  await r.text(ME, 'now');
  await r.jump(7);
  const after = r.inRoom().length;

  const second = await r.jump(0);
  assert.deepEqual(second, { posts: 0, chases: 0, errors: [] });
  assert.equal(r.inRoom().length, after, 'the second pass duplicated a post');
});

test('the day-7 question quotes the entry so the group knows which date', async () => {
  const r = await onboarded(rig());
  await r.text(ME, 'Coffee at Spyhouse with the architect, talked three hours');
  await r.text(ME, 'now');
  await r.jump(7);
  const chase = r.inRoom().at(-1);
  assert.match(chase, /did you call her/);
  assert.match(chase, /Spyhouse/, 'the question did not say which date it meant');
});

test('dates in copy are never a bare weekday', async () => {
  // "Sunday" seven days out reads as the Sunday two days from now.
  const r = await onboarded(rig());
  await r.text(ME, 'Coffee at Spyhouse, talked three hours, it went really well');
  await r.text(ME, 'wait');
  const said = r.toldTo(ME).at(-1);
  assert.match(said, /[A-Z][a-z]{2},? [A-Z][a-z]{2} \d+/, `no date in: ${said}`);
  assert.doesNotMatch(said, /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/,
    `a bare weekday name is ambiguous seven days out: ${said}`);
});

test('a friend who never said YES receives exactly one message, ever', async () => {
  const r = await onboarded(rig());
  await r.text(SAM, `join ${r.code()}`);
  await r.text(ME, 'Coffee at Spyhouse, talked three hours, it went really well');
  await r.text(ME, 'now');
  assert.equal(r.toldTo(SAM).length, 1, 'we messaged someone who never consented');
  assert.ok(!r.members().includes(SAM));
});

test('STOP removes them from every room they were in, not just their own', async () => {
  const r = await onboarded(rig());
  await r.text(MIKE, 'STOP');
  assert.ok(!r.members().includes(MIKE));
  assert.equal(await r.db.countActiveCircle(r.me().id), 0);
});

test('an explicit entry leaves no trace and no state change', async () => {
  const db = memoryDb();
  const channel = consoleChannel({ quiet: true });
  const scrub = async () => ({ clean: '', removedNames: [], explicit: true });
  const engine = createEngine({ db, channel, scrub });
  const r = { db, channel, engine, text: (f, b) => engine.inbound(f, b),
              code: () => db._tables.users[0].join_code,
              inRoom: () => channel._said.map((m) => m.body),
              me: () => db._tables.users.find((u) => u.phone === ME) };
  await onboarded(r);
  const roomsBefore = r.inRoom().length;

  await r.text(ME, 'a long enough entry that would otherwise be banked as one');

  assert.equal(db._tables.entries.length, 0);
  assert.equal(r.inRoom().length, roomsBefore);
  assert.equal(r.me().state, S.READY, 'a refusal must not strand them mid-flow');
});
