// The content guard against the real model. Opt-in, because it costs money:
//
//   ANTHROPIC_API_KEY=... node --test test/scrub.live.test.js
//
// Skipped otherwise, so the default suite stays free and instant.
//
// Every case here is a defect this guard actually had. It invented "the girl
// from the app" about someone met in person — a fabricated fact his friends
// would have read as true. Then it over-corrected and deleted a real detail
// ("Rachel from the bookstore" -> "her"). Both are pinned below.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const live = !!process.env.ANTHROPIC_API_KEY;
const opts = { skip: live ? false : 'set ANTHROPIC_API_KEY to run' };

const { scrub } = live ? await import('../lib/scrub.js') : { scrub: null };

test('a name goes, and nothing is invented to replace it', opts, async () => {
  const r = await scrub(
    'Coffee with Sarah Miller at Spyhouse in Uptown. Talked three hours, ' +
    'she laughed at the bad joke about my dog.');
  assert.deepEqual(r.removedNames, ['Sarah Miller']);
  assert.doesNotMatch(r.clean, /Sarah|Miller/);
  // The original defect: nothing in this entry mentions an app or a setup.
  assert.doesNotMatch(r.clean, /\b(app|Tinder|Hinge|Bumble|set ?up|blind date)\b/i,
    `invented a circumstance: ${r.clean}`);
  // And it must not name the venue twice.
  assert.doesNotMatch(r.clean, /Spyhouse.*Spyhouse/, `redundant handle: ${r.clean}`);
});

test('place names survive — they are what makes an entry worth reading', opts, async () => {
  const r = await scrub(
    'Met Jess at Owamni, then we walked the Stone Arch. Her friend Kayla ' +
    'texted her twice during dinner which was annoying.');
  assert.match(r.clean, /Owamni/);
  assert.match(r.clean, /Stone Arch/);
  assert.doesNotMatch(r.clean, /Jess|Kayla/);
  assert.equal(r.removedNames.length, 2);
});

test('the name is replaced, not the phrase around it', opts, async () => {
  const r = await scrub(
    'Second time seeing Rachel from the bookstore. Coffee after the Tuesday ' +
    'loop. She ordered the whole fish.');
  assert.doesNotMatch(r.clean, /Rachel/);
  // The over-correction this pins: "from the bookstore" is a real detail and
  // deleting it loses information the guard was never asked to touch.
  assert.match(r.clean, /bookstore/, `deleted a real detail: ${r.clean}`);
  assert.match(r.clean, /whole fish/);
});

test('a stated fact becomes the handle', opts, async () => {
  const r = await scrub(
    'Dinner with Emma. She is a pastry chef, does the bread at that place on Hennepin.');
  assert.doesNotMatch(r.clean, /Emma/);
  assert.match(r.clean, /pastry chef|chef|baker/);
});

test('their voice, typos and punctuation are left alone', opts, async () => {
  const raw = 'went to Hai Hai w/ Maddie.. tbh i wasnt feeling it?? she was nice tho. prob not gonna call';
  const r = await scrub(raw);
  assert.doesNotMatch(r.clean, /Maddie/);
  for (const tell of ['w/', '..', 'tbh', 'wasnt', '??', 'tho', 'prob not gonna call']) {
    assert.ok(r.clean.includes(tell), `"${tell}" was cleaned up: ${r.clean}`);
  }
});

test('graphic content is flagged; frank content is not', opts, async () => {
  const explicit = await scrub(
    'Went back to hers and we fucked for two hours, best sex I have had in a year.');
  assert.equal(explicit.explicit, true);

  const frank = await scrub(
    'Real attraction, we made out in the car for twenty minutes like teenagers. ' +
    'Did not go further.');
  assert.equal(frank.explicit, false,
    'kissing is not SHAFT content; flagging it would make the tool useless');
});
