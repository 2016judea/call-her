import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, S, HOLD_DAYS } from '../lib/machine.js';

const NOW = new Date('2026-08-23T18:00:00Z');
const OUR = '+16125550100';
const ME   = '+16125550111';
const BUD  = '+16125550222';

const base = (over = {}) => ({
  now: NOW, ourNumber: OUR, user: null, invite: null, inviteOwner: null,
  codeOwner: null, codeOwnerCircleCount: 0, activeCircle: [], openEntry: null,
  scrub: null, random: () => 0.5, ...over,
});
const user = (over = {}) => ({
  id: 1, phone: ME, handle: 'Aidan', join_code: 'k7m2',
  state: S.READY, conversation_sid: 'CH1', ...over,
});
const sms  = (body, from = ME) => ({ type: 'sms', from, body });
const kinds = (r) => r.effects.map((e) => e.type);
const said  = (r) => r.replies.map((x) => x.body).join('\n');

test('an unknown number becomes a creator and is asked for a handle', () => {
  const r = machine(base(), sms('hey whats this'));
  assert.deepEqual(kinds(r), ['create_user']);
  assert.match(said(r), /What should they see you as/);
});

test('STOP wins over an in-flight mode question', () => {
  // The dangerous case: state says we're waiting for NOW/WAIT, and "stop"
  // must not be read as prose or swallowed by that state.
  const r = machine(base({ user: user({ state: S.AWAITING_MODE }),
                           openEntry: { id: 9, body: 'x' } }), sms('STOP'));
  assert.deepEqual(kinds(r), ['stop']);
  assert.doesNotMatch(said(r), /NOW or WAIT/);
});

test('HELP answers without touching state, in any state', () => {
  for (const state of Object.values(S)) {
    const r = machine(base({ user: user({ state }) }), sms('help'));
    assert.deepEqual(r.effects, [], `effects leaked in ${state}`);
    assert.match(said(r), /STOP to leave/);
  }
});

test('an entry cannot be posted into a circle of zero', () => {
  const r = machine(base({ user: user({ state: S.BUILDING_CIRCLE }) }),
                    sms('Coffee at Spyhouse, talked three hours, it was great'));
  assert.deepEqual(r.effects, []);
  assert.match(said(r), /nobody in your circle yet/);
  assert.match(said(r), /join k7m2/);
});

test('explicit content is refused and never stored', () => {
  const r = machine(base({
    user: user(), activeCircle: [{ phone: BUD }],
    scrub: { clean: 'x', removedNames: [], explicit: true },
  }), sms('a long enough entry to pass the length floor, explicit'));
  assert.deepEqual(r.effects, [], 'nothing may be written on a refusal');
  assert.match(said(r), /carriers block explicit content/);
});

test('a scrubbed name is reported to the author, and the clean body is stored', () => {
  const r = machine(base({
    user: user(), activeCircle: [{ phone: BUD }],
    scrub: { clean: 'Coffee with the architect', removedNames: ['Sarah'], explicit: false },
  }), sms('Coffee with Sarah Miller, talked for three hours'));
  const entry = r.effects.find((e) => e.type === 'create_entry');
  assert.equal(entry.clean, 'Coffee with the architect');
  assert.equal(entry.raw, 'Coffee with Sarah Miller, talked for three hours');
  assert.match(said(r), /took a name out/);
});

test('NOW posts immediately and schedules the chase 7 days out', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_MODE }), activeCircle: [{ phone: BUD }],
    openEntry: { id: 9, body: 'Coffee at Spyhouse' },
  }), sms('now'));
  const mode = r.effects.find((e) => e.type === 'set_entry_mode');
  assert.equal(mode.mode, 'now');
  assert.equal(mode.chaseAt.getTime() - NOW.getTime(), HOLD_DAYS * 86400000);
  assert.ok(kinds(r).includes('post_entry'));
});

test('WAIT posts nothing now and schedules the post 7 days out', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_MODE }), activeCircle: [{ phone: BUD }],
    openEntry: { id: 9, body: 'Coffee at Spyhouse' },
  }), sms('wait'));
  assert.ok(!kinds(r).includes('post_entry'), 'a held entry must not reach the room');
  const mode = r.effects.find((e) => e.type === 'set_entry_mode');
  assert.equal(mode.mode, 'wait');
  assert.equal(mode.postAt.getTime() - NOW.getTime(), HOLD_DAYS * 86400000);
  assert.equal(mode.chaseAt, null, 'a held entry is never also chased');
});

test('an unparseable mode reply re-asks instead of becoming a new entry', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_MODE }), openEntry: { id: 9, body: 'x' },
  }), sms('idk what do you think honestly'));
  assert.deepEqual(r.effects, []);
  assert.equal(said(r), 'NOW or WAIT.');
});

test('a held entry coming due asks for the outcome before it posts', () => {
  const r = machine(base(), {
    type: 'due_post',
    entry: { id: 9, body: 'Coffee at Spyhouse', outcome: null },
    author: user(),
  });
  assert.ok(!kinds(r).includes('post_entry'));
  assert.deepEqual(kinds(r), ['mark_outcome_asked', 'set_state']);
  assert.match(said(r), /what happened/);
});

test('the outcome reply posts entry and outcome together, once', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_OUTCOME }),
    openEntry: { id: 9, body: 'Coffee at Spyhouse' },
  }), sms('Called her Thursday. Dinner Saturday.'));
  const post = r.effects.find((e) => e.type === 'post_entry');
  assert.match(post.body, /Coffee at Spyhouse/);
  assert.match(post.body, /Called her Thursday/);
  assert.equal(r.effects.filter((e) => e.type === 'post_entry').length, 1);
});

test('the chase lands in the group, not in a DM, and is marked so it fires once', () => {
  const r = machine(base(), {
    type: 'due_chase', entry: { id: 9 }, author: user(),
  });
  assert.deepEqual(kinds(r), ['mark_chased', 'group']);
  assert.deepEqual(r.replies, [], 'the chase is public; a private nudge defeats it');
  assert.match(r.effects[1].body, /did you call her/);
});

test('a buddy joining is invited, not added — consent comes from them', () => {
  const r = machine(base({
    codeOwner: { id: 1, phone: ME, handle: 'Aidan' }, codeOwnerCircleCount: 2,
  }), sms('join k7m2', BUD));
  assert.deepEqual(kinds(r), ['create_invite']);
  assert.ok(!kinds(r).includes('add_to_room'), 'nobody enters a room before saying yes');
  assert.match(said(r), /Reply YES to join/);
});

test('YES on a pending invite adds them to the room and tells the owner', () => {
  const r = machine(base({
    invite: { owner_id: 1, phone: BUD, status: 'pending', circleCountAfter: 3 },
    inviteOwner: { id: 1, phone: ME, handle: 'Aidan' },
  }), sms('yes', BUD));
  assert.deepEqual(kinds(r), ['activate_invite', 'add_to_room']);
  assert.equal(r.replies.length, 2);
  assert.equal(r.replies[1].to, ME);
});

test('a pending invite blocks that number from being read as an entry', () => {
  const r = machine(base({
    invite: { owner_id: 1, phone: BUD, status: 'pending', circleCountAfter: 3 },
    inviteOwner: { id: 1, phone: ME, handle: 'Aidan' },
  }), sms('Coffee at Spyhouse, talked three hours, it went well', BUD));
  assert.deepEqual(r.effects, [], 'no consent yet means no writes');
  assert.match(said(r), /Reply YES to join/);
});

test('you cannot join your own circle', () => {
  const r = machine(base({
    codeOwner: { id: 1, phone: ME, handle: 'Aidan' }, codeOwnerCircleCount: 0,
  }), sms('join k7m2', ME));
  assert.deepEqual(r.effects, []);
});

test('a full circle is refused at the carrier cap', () => {
  const r = machine(base({
    codeOwner: { id: 1, phone: ME, handle: 'Aidan' }, codeOwnerCircleCount: 8,
  }), sms('join k7m2', BUD));
  assert.deepEqual(r.effects, []);
  assert.match(said(r), /full/);
});

test('a stopped user is met with silence, not a welcome', () => {
  const r = machine(base({ user: user({ state: S.STOPPED }) }), sms('hey you there'));
  assert.deepEqual(r.effects, []);
  assert.deepEqual(r.replies, []);
});

test('one-word chatter is not mistaken for a journal entry', () => {
  const r = machine(base({ user: user(), activeCircle: [{ phone: BUD }] }), sms('hey'));
  assert.deepEqual(r.effects, []);
  assert.match(said(r), /a bit more than that/);
});
