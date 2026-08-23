import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, S, QUIET_DAYS, OUTCOME_DAYS, MODE_GRACE_DAYS } from '../lib/machine.js';

const NOW = new Date('2026-08-23T18:00:00Z');
const OUR = '+16125550100';
const ME   = '+16125550111';
const BUD  = '+16125550222';

const base = (over = {}) => ({
  now: NOW, ourNumber: OUR, user: null, invite: null, inviteOwner: null,
  codeOwner: null, codeOwnerCircleCount: 0, activeCircle: [], openEntry: null,
  scrub: null, random: () => 0.5,
  // Supplied by the channel in production — see lib/engine.js.
  canInviteByCode: true,
  invite_how: 'Send them this:\n"Text  join k7m2  to (612) 555-0100"',
  ...over,
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
    scrub: { clean: 'Coffee with the one who ordered the whole fish', removedNames: ['Sarah'], explicit: false },
  }), sms('Coffee with Sarah Miller, talked for three hours'));
  const entry = r.effects.find((e) => e.type === 'create_entry');
  assert.equal(entry.clean, 'Coffee with the one who ordered the whole fish');
  assert.equal(entry.raw, 'Coffee with Sarah Miller, talked for three hours');
  assert.match(said(r), /took a name out/);
});

// The premise, pinned. The group chat is the product: an entry that does not
// reach the room is the one thing this cannot do, in EITHER mode. A previous
// build had WAIT hold the entry back for a week, which is the opposite of the
// brief ("you will see your buddies replies... 1 week later" — the delay is on
// HIM, not on them). These two tests exist to stop that coming back.
test('an entry carries both clocks from the moment it is written', () => {
  const r = machine(base({
    user: user(), activeCircle: [{ phone: BUD }],
  }), sms('Dinner at Owamni with the one who ordered the whole fish'));
  const e = r.effects.find((x) => x.type === 'create_entry');
  assert.equal(e.chaseAt.getTime() - NOW.getTime(), OUTCOME_DAYS * 86400000,
    'his one update is asked for two weeks after the date, not the reply');
  assert.equal(e.postAt.getTime() - NOW.getTime(), MODE_GRACE_DAYS * 86400000);
});

test('NOW posts to the room and names the two-week date', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_MODE }), activeCircle: [{ phone: BUD }],
    openEntry: { id: 9, body: 'Coffee at Spyhouse',
                 created_at: NOW, chase_at: new Date('2026-09-06T18:00:00Z') },
  }), sms('now'));
  assert.equal(r.effects.find((e) => e.type === 'set_entry_mode').mode, 'now');
  const post = r.effects.find((e) => e.type === 'post_entry');
  assert.match(post.body, /Coffee at Spyhouse/);
  assert.doesNotMatch(post.body, /isn't reading/, 'NOW carries no hold notice');
  assert.match(said(r), /Sun Sep 6/);
});

test('WAIT also posts to the room, with the hold stated where the room can see it', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_MODE }), activeCircle: [{ phone: BUD }],
    openEntry: { id: 9, body: 'Coffee at Spyhouse',
                 created_at: NOW, chase_at: new Date('2026-09-06T18:00:00Z') },
  }), sms('wait'));
  const post = r.effects.find((e) => e.type === 'post_entry');
  assert.ok(post, 'WAIT must still reach the room — the room is the product');
  assert.match(post.body, /Coffee at Spyhouse/);
  // He is a member of this room; no code can keep him out of it. The hold is a
  // norm, so it is addressed to the people who can actually honour it.
  assert.match(post.body, /Aidan isn't reading this till Sun Aug 30/);
  assert.match(post.body, /talk among yourselves/);
  assert.equal(r.effects.find((e) => e.type === 'set_entry_mode').mode, 'wait');
});

test('both dates hang off the same anchor, so they can never disagree', () => {
  // Found by driving the simulator: deriving the hold date from the entry's
  // stored created_at printed a date two weeks in the past, because the store
  // stamps that column from the real clock and not the engine's injected one.
  const r = machine(base({
    now: new Date('2026-08-24T09:00:00Z'),   // he answered the next morning
    user: user({ state: S.AWAITING_MODE }), activeCircle: [{ phone: BUD }],
    openEntry: { id: 9, body: 'Coffee at Spyhouse',
                 created_at: new Date('1999-01-01T00:00:00Z'),   // a liar
                 chase_at: new Date('2026-09-06T18:00:00Z') },
  }), sms('wait'));
  assert.equal(OUTCOME_DAYS - QUIET_DAYS, 7);
  assert.match(r.effects.find((e) => e.type === 'post_entry').body, /Sun Aug 30/);
  assert.match(said(r), /till Sun Aug 30/);
  assert.match(said(r), /Sun Sep 6 for what happened/);
});

test('an unparseable mode reply re-asks instead of becoming a new entry', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_MODE }), openEntry: { id: 9, body: 'x' },
  }), sms('idk what do you think honestly'));
  assert.deepEqual(r.effects, []);
  assert.equal(said(r), 'NOW or WAIT.');
});

test('an unanswered mode question still puts the entry in the room', () => {
  // Otherwise the journal reaches nobody AND he is wedged in AWAITING_MODE,
  // where every later entry comes back as "NOW or WAIT."
  const r = machine(base(), {
    type: 'due_post',
    entry: { id: 9, body: 'Coffee at Spyhouse', mode: null,
             chase_at: new Date('2026-09-06T18:00:00Z') },
    author: user({ state: S.AWAITING_MODE }),
  });
  assert.deepEqual(kinds(r), ['set_entry_mode', 'post_entry', 'set_state']);
  assert.equal(r.effects[2].state, S.READY, 'and he is un-wedged');
  assert.match(r.effects[1].body, /Coffee at Spyhouse/);
  assert.match(said(r), /You never said/);
});

test('the two-week question is asked of HIM, never of the room', () => {
  // His brief: the creator "is allowed to give one update". An earlier build
  // posted "did you call her?" into the group, which is an interrogation.
  const r = machine(base(), {
    type: 'due_chase', entry: { id: 9, body: 'Coffee at Spyhouse' }, author: user(),
  });
  assert.deepEqual(kinds(r), ['mark_chased', 'mark_outcome_asked', 'set_state']);
  assert.ok(!kinds(r).includes('group'), 'nothing is said to the room here');
  assert.deepEqual(r.replies.map((x) => x.to), [ME]);
  assert.match(said(r), /Two weeks. Your turn/);
});

test('his one update joins an entry already in the room, and is not a re-post', () => {
  const r = machine(base({
    user: user({ state: S.AWAITING_OUTCOME }),
    openEntry: { id: 9, body: 'Coffee at Spyhouse', outcome_asked_at: NOW },
  }), sms('Called her Thursday. Dinner Saturday.'));
  assert.ok(!kinds(r).includes('post_entry'), 'the entry was posted two weeks ago');
  const said_in_room = r.effects.find((e) => e.type === 'group');
  assert.match(said_in_room.body, /Called her Thursday/);
  assert.doesNotMatch(said_in_room.body, /Coffee at Spyhouse/, 'no duplicate entry');
  assert.match(said(r), /one update/);
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
