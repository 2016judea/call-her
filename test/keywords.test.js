import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, canon, makeJoinCode } from '../lib/keywords.js';
import { normalize, pretty } from '../lib/phone.js';

test('punctuation and case never hide a keyword', () => {
  for (const s of ['STOP', 'stop.', ' Stop! ', 'STOP?']) {
    assert.equal(classify(s).kind, 'stop', s);
  }
  for (const s of ['wait', 'WAIT.', 'Wait!', ' hold ']) {
    assert.equal(classify(s).kind, 'wait', s);
  }
});

test('a join code is read case-insensitively', () => {
  assert.deepEqual(classify('JOIN K7M2'), { kind: 'join', code: 'k7m2' });
  assert.deepEqual(classify('join k7m2'), { kind: 'join', code: 'k7m2' });
});

test('a malformed join is prose, not a join', () => {
  assert.equal(classify('join').kind, 'text');
  assert.equal(classify('join k7m').kind, 'text');
  assert.equal(classify('joining the gym tomorrow').kind, 'text');
});

test('prose that merely contains a keyword is still prose', () => {
  // The failure this guards: "we should wait and see" must not be read as WAIT.
  assert.equal(classify('we should wait and see how it goes').kind, 'text');
  assert.equal(classify('she said stop being weird').kind, 'text');
  assert.equal(classify('now that was a good night').kind, 'text');
});

test('canon leaves interior punctuation alone', () => {
  assert.equal(canon('  Hey, there!  '), 'hey, there');
});

test('join codes avoid characters that break when read aloud', () => {
  const alphabet = new Set('abcdefghjkmnpqrstuvwxyz23456789');
  for (let i = 0; i < 200; i++) {
    const c = makeJoinCode();
    assert.equal(c.length, 4);
    for (const ch of c) assert.ok(alphabet.has(ch), `${c} contains ${ch}`);
  }
});

test('phone numbers normalise to E.164 or are rejected outright', () => {
  assert.equal(normalize('(612) 555-0123'), '+16125550123');
  assert.equal(normalize('612-555-0123'), '+16125550123');
  assert.equal(normalize('16125550123'), '+16125550123');
  assert.equal(normalize('+16125550123'), '+16125550123');
  // Group MMS is +1 only. Anything else must be rejected, not guessed at.
  assert.equal(normalize('+447700900123'), null);
  assert.equal(normalize('555-0123'), null);
  assert.equal(normalize(''), null);
  assert.equal(normalize(null), null);
});

test('pretty round-trips for copy', () => {
  assert.equal(pretty('+16125550123'), '(612) 555-0123');
  assert.equal(pretty('nonsense'), 'nonsense');
});
