// Drive the whole product in a terminal. No Twilio, no Postgres, no API key.
//
//   node sim/drive.js              scripted run of the full loop, both modes
//   node sim/drive.js --repl       type as any number, `/help` for controls
//
// Uses lib/engine.js — the exact path production takes.

import { createInterface } from 'node:readline/promises';
import { memoryDb } from './memory-db.js';
import { consoleChannel } from './console-channel.js';
import { createEngine } from '../lib/engine.js';

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;

/** Stand-in for lib/scrub.js: same contract, no model, no key, no cost. */
function fakeScrub() {
  const NAMES = /\b(Sarah|Jess|Jessica|Kayla|Emma|Maddie|Claire|Anna|Rachel|Sam|Miller|Nguyen)\b/g;
  const EXPLICIT = /\b(fuck(ed|ing)?|blew|nudes?|slept with her)\b/i;
  return async (body) => {
    const removed = [...new Set(body.match(NAMES) ?? [])];
    return {
      clean: body.replace(NAMES, 'her').replace(/\bwith her\b/g, 'with her'),
      removedNames: removed,
      explicit: EXPLICIT.test(body),
    };
  };
}

function harness() {
  const db = memoryDb();
  const channel = consoleChannel();
  let clock = new Date('2026-08-23T23:42:00-05:00');
  const engine = createEngine({
    db, channel, scrub: fakeScrub(), now: () => new Date(clock),
  });
  return {
    db, channel, engine,
    now: () => new Date(clock),
    async text(from, body) {
      channel.echoIn(from, body);
      return engine.inbound(from, body);
    },
    async jump(days) {
      clock = new Date(clock.getTime() + days * 86400000);
      console.log(D(`\n  ⟳ ${days} day${days === 1 ? '' : 's'} pass — ${clock.toDateString()}\n`));
      const r = await engine.tick();
      if (r.errors.length) console.log('  ERRORS', r.errors);
      return r;
    },
    dump() {
      const { users, circles, entries } = db._tables;
      console.log(D('  ── state ' + '─'.repeat(52)));
      for (const u of users) {
        const mine = circles.filter((c) => c.owner_id === u.id && c.status === 'active');
        console.log(D(`  ${u.phone}  ${u.handle ?? '—'}  ${u.state}  circle:${mine.length}  code:${u.join_code}`));
      }
      for (const e of entries) {
        console.log(D(`  entry#${e.id} mode=${e.mode ?? '—'} posted=${e.posted_at ? 'y' : 'n'} ` +
                      `chased=${e.chased_at ? 'y' : 'n'} outcome=${e.outcome ? JSON.stringify(e.outcome.slice(0,28)) : '—'}`));
      }
      console.log(D('  ' + '─'.repeat(61) + '\n'));
    },
  };
}

const scene = (t) => console.log(`\n${B('▌ ' + t)}\n`);

async function scripted() {
  const h = harness();
  const ME = '+16125550111', MIKE = '+16125550222', SAM = '+16125550333';

  scene('1. A stranger texts the number');
  await h.text(ME, 'saw this on substack, what is it');
  await h.text(ME, 'Aidan');

  scene('2. Two friends join with the line he forwarded');
  const code = h.db._tables.users[0].join_code;
  await h.text(MIKE, `join ${code}`);
  await h.text(MIKE, 'yes');
  await h.text(SAM, `join ${code}`);
  await h.text(SAM, 'yes');
  h.dump();

  scene('3. He posts an entry and opens it now');
  await h.text(ME, 'Coffee with Sarah at Spyhouse. Talked three hours, she laughed at the bad joke about the dog. Calling her Thursday.');
  await h.text(ME, 'now');

  scene('4. A friend replies in the group; a week passes');
  h.channel.echoIn(MIKE, '[in the group] three hours?? call her');
  await h.jump(7);
  h.dump();

  scene('5. Second date, and this time he holds it');
  await h.text(ME, 'Drinks at Marvel Bar with the girl from the bookstore. Good chemistry. Not sure yet.');
  await h.text(ME, 'wait');

  scene('6. Nothing reaches the circle for a week');
  await h.jump(3);
  console.log(D('  (nothing — correct: the entry is still his alone)\n'));
  await h.jump(4);
  await h.text(ME, 'Called her. We are getting dinner Saturday.');
  h.dump();

  scene('7. The guards');
  await h.text(ME, 'hey');
  await h.text(ME, 'Went home with her and we fucked, honestly it was a mess');
  await h.text(SAM, 'STOP');
  h.dump();

  scene('8. What each person actually received');
  const to = (p) => h.channel._sent.filter((m) => m.to === p).length;
  console.log(`  ${ME} (creator): ${to(ME)} messages`);
  console.log(`  ${MIKE} (friend): ${to(MIKE)} messages`);
  console.log(`  ${SAM}  (friend): ${to(SAM)} messages`);
  console.log(`  group posts: ${h.channel._said.length}`);
  console.log();
}

async function repl() {
  const h = harness();
  let me = '+16125550111';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(B('\n  Call Her — simulator') + D('\n  /as <number>  /jump <days>  /state  /quit\n'));
  for (;;) {
    const line = (await rl.question(D(`  ${me} › `))).trim();
    if (!line) continue;
    if (line === '/quit' || line === '/q') break;
    if (line === '/state') { h.dump(); continue; }
    if (line.startsWith('/as ')) { me = line.slice(4).trim(); continue; }
    if (line.startsWith('/jump ')) { await h.jump(Number(line.slice(6)) || 1); continue; }
    try { await h.text(me, line); } catch (e) { console.log('  ✗', e.message); }
  }
  rl.close();
}

await (process.argv.includes('--repl') ? repl() : scripted());
