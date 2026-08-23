// The Telegram channel end to end, over lib/telegram-flow.js + lib/engine.js.
// This is the fallback path if carrier registration is refused, so it has to
// work without anyone having driven it by hand first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from '../sim/memory-db.js';
import { createEngine } from '../lib/engine.js';
import { createTelegramFlow } from '../lib/telegram-flow.js';
import { S } from '../lib/machine.js';

const ME = 4001, OTHER = 4002, GROUP = -1001234567890;

function rig() {
  const db = memoryDb();
  const sent = [], said = [];
  let clock = new Date('2026-08-23T23:42:00-05:00');
  const channel = {
    ourNumber: '@CallHerBot',
    canInviteByCode: false,
    inviteHow: () => "Don't make a new group — add me to the one you already " +
      'have with them, then send  /claim  in it.',
    asId: (id) => `tg:${id}`,
    send: async (to, body) => { sent.push({ to, body }); },
    sayInRoom: async (sid, body) => { said.push({ sid: String(sid), body }); },
    createRoom: async () => { throw new Error('a bot cannot create a group'); },
    addToRoom: async () => {},
    removeFromRoom: async () => {},
  };
  const scrub = async (b) => ({ clean: b, removedNames: [], explicit: false });
  const engine = createEngine({ db, channel, scrub, now: () => new Date(clock) });
  const flow = createTelegramFlow({ db, channel, engine });

  return {
    db, sent, said, engine, flow,
    dm:    (id, text) => flow.route({ message: {
             text, from: { id }, chat: { id, type: 'private' } } }),
    group: (id, text, chat = GROUP) => flow.route({ message: {
             text, from: { id }, chat: { id: chat, type: 'supergroup' } } }),
    evicted: (chat = GROUP) => flow.route({ my_chat_member: {
             chat: { id: chat }, new_chat_member: { status: 'left' } } }),
    jump: async (days) => {
      clock = new Date(clock.getTime() + days * 86400000);
      return engine.tick();
    },
    user: (id = ME) => db._tables.users.find((u) => u.phone === `tg:${id}`),
    toldTo: (id) => sent.filter((m) => m.to === `tg:${id}`).map((m) => m.body),
    inGroup: () => said.map((m) => m.body),
  };
}

async function setUp(r) {
  await r.dm(ME, '/start');
  await r.dm(ME, 'Aidan');
  await r.group(ME, '/claim');
  return r;
}

test('a Telegram user is never handed a join code', async () => {
  // The defect Aidan's first live test surfaced (2026-08-23): copy.handleSet
  // hardcoded the SMS answer, so the bot replied  "Text join 4k4v to
  // @CallHerBot"  — a code that does nothing on this channel.
  const r = rig();
  await r.dm(ME, '/start');
  await r.dm(ME, 'Aidan');
  const said = r.toldTo(ME).at(-1);
  assert.doesNotMatch(said, /join\s+[a-z0-9]{4}/i, `handed out a join code: ${said}`);
  assert.match(said, /\/claim/, 'did not say how to actually do it');
});

test('a join code is refused here rather than crashing on createRoom', async () => {
  // And if someone followed that copy anyway: YES would reach add_to_room ->
  // room() -> createRoom(), which throws on this channel by design.
  const r = await setUp(rig());
  await r.dm(OTHER, 'join abcd');
  assert.match(r.toldTo(OTHER).at(-1), /not how it works on this one/);
  assert.equal(r.db._tables.circles.filter((c) => c.phone === `tg:${OTHER}`).length, 0);
});

test('the drained-circle message also says how to fix it, per channel', async () => {
  const r = await setUp(rig());
  await r.evicted();
  await r.dm(ME, 'Dinner at Owamni with the one who ordered the whole fish, talked three hours');
  const said = r.toldTo(ME).at(-1);
  assert.match(said, /nobody in your circle yet/);
  assert.match(said, /\/claim/, 'told them the problem but not the remedy');
  assert.doesNotMatch(said, /join\s+[a-z0-9]{4}/i);
});

test('a creator binds the group chat they already have', async () => {
  const r = await setUp(rig());
  assert.equal(r.user().conversation_sid, String(GROUP));
  assert.equal(r.user().state, S.READY);
  assert.match(r.inGroup().at(-1), /Bound/);
});

test('the setup instruction says to reuse the existing group, not make one', async () => {
  // The whole premise is the group chat they already have with those friends.
  const r = rig();
  await r.dm(ME, '/start');
  await r.dm(ME, 'Aidan');
  await r.dm(ME, '/start');
  assert.match(r.toldTo(ME).at(-1), /Don't make a new group/);
});

test('an @mention on the command is stripped', async () => {
  const r = rig();
  await r.dm(ME, '/start');
  await r.dm(ME, 'Aidan');
  await r.group(ME, '/claim@CallHerBot');
  assert.equal(r.user().state, S.READY);
});

test('a stranger cannot claim a group that is already someone else\'s', async () => {
  const r = await setUp(rig());
  await r.dm(OTHER, '/start');
  await r.dm(OTHER, 'Mike');
  await r.group(OTHER, '/claim');
  assert.match(r.inGroup().at(-1), /needs to send \/claim, not me/);
  assert.equal(r.user(OTHER).conversation_sid, null);
});

test('claiming without messaging the bot first is refused, with the fix', async () => {
  const r = rig();
  await r.group(OTHER, '/claim');
  assert.match(r.inGroup().at(-1), /message me privately first/);
  assert.equal(r.db._tables.users.length, 0, 'no account may be created from a group');
});

test('re-claiming your own group does not re-announce', async () => {
  const r = await setUp(rig());
  const before = r.inGroup().length;
  await r.group(ME, '/claim');
  assert.equal(r.inGroup().length, before);
});

test('the full loop runs on this channel, NOW mode', async () => {
  const r = await setUp(rig());
  await r.dm(ME, 'Dinner at Owamni with the one who ordered the whole fish, talked three hours');
  assert.match(r.toldTo(ME).at(-1), /NOW or WAIT/);
  await r.dm(ME, 'now');
  assert.match(r.inGroup().at(-1), /Owamni/);
  await r.jump(7);
  assert.match(r.inGroup().at(-1), /did you call her/);
});

test('the full loop runs on this channel, WAIT mode', async () => {
  const r = await setUp(rig());
  await r.dm(ME, 'Drinks at Marvel Bar with the girl from the bookstore, good chemistry');
  await r.dm(ME, 'wait');
  const held = r.inGroup().length;
  await r.jump(6);
  assert.equal(r.inGroup().length, held, 'a held entry leaked early');
  await r.jump(1);
  await r.dm(ME, 'Called her Thursday.');
  assert.match(r.inGroup().at(-1), /Called her Thursday/);
});

test('group chatter is ignored — only /claim is heard there', async () => {
  const r = await setUp(rig());
  const before = r.inGroup().length;
  await r.group(OTHER, 'three hours?? call her');
  assert.equal(r.inGroup().length, before);
  assert.equal(r.db._tables.entries.length, 0, 'group chatter became an entry');
});

test('being removed from the group forgets it and sends them back to setup', async () => {
  const r = await setUp(rig());
  await r.evicted();
  assert.equal(r.user().conversation_sid, null);
  assert.equal(r.user().state, S.BUILDING_CIRCLE);

  // And with no room, an entry must be refused rather than crash on createRoom.
  await r.dm(ME, 'Dinner at Owamni with the one who ordered the whole fish, talked three hours');
  assert.equal(r.db._tables.entries.length, 0);
  assert.match(r.toldTo(ME).at(-1), /nobody in your circle yet/);
});

test('STOP works on this channel too', async () => {
  const r = await setUp(rig());
  await r.dm(ME, 'stop');
  assert.equal(r.user().state, S.STOPPED);
  await r.dm(ME, 'hey you there');
  assert.match(r.toldTo(ME).at(-1), /dropped your number/);
});
