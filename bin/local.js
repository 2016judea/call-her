// Run the real bot from this laptop. No deploy, no webhook, no Postgres.
//
//   node bin/local.js
//
// Long-polls getUpdates instead of receiving a webhook, so it needs no public
// URL. State lives in .local-store.json and survives restarts. Everything else
// is production code: lib/telegram.js talks to the real Bot API, lib/scrub.js
// calls the real model, lib/engine.js is the same path the webhook would take.
//
// Ctrl-C to stop. While it is not running the bot simply does not answer;
// Telegram queues updates for ~24h and they are picked up on restart.

import { readFileSync } from 'node:fs';
import { fileDb } from '../sim/file-db.js';
import { createEngine } from '../lib/engine.js';
import { createTelegramFlow } from '../lib/telegram-flow.js';

// Load .env without a dependency.
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const [{ scrub }, channel] = await Promise.all([
  import('../lib/scrub.js'),
  import('../lib/telegram.js'),
]);

const D = (s) => `\x1b[2m${s}\x1b[0m`;
const IN = (s) => `\x1b[38;5;252m${s}\x1b[0m`;
const OUT = (s) => `\x1b[38;5;209m${s}\x1b[0m`;
const ROOM = (s) => `\x1b[38;5;114m${s}\x1b[0m`;

const db = fileDb(new URL('../.local-store.json', import.meta.url).pathname);

// Wrap the channel so everything the bot says is visible in this terminal.
const loud = {
  ...channel,
  send: async (to, body) => {
    console.log(`${OUT('→ ' + to)}\n${indent(body)}\n`);
    return channel.send(to, body);
  },
  sayInRoom: async (sid, body) => {
    console.log(`${ROOM('→ group ' + sid)}\n${indent(body)}\n`);
    return channel.sayInRoom(sid, body);
  },
};
const indent = (s) => String(s).split('\n').map((l) => '    ' + l).join('\n');

const engine = createEngine({ db, channel: loud, scrub });
const flow = createTelegramFlow({ db, channel: loud, engine });

const me = await fetch(
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
).then((r) => r.json());
if (!me.ok) { console.error('bad token:', me.description); process.exit(1); }

console.log(`\n  ${OUT('Call Her')} — running as @${me.result.username}`);
console.log(D(`  DM the bot to start. Ctrl-C to stop.\n`));

// The daily pass, on a timer rather than a cron.
setInterval(async () => {
  try {
    const r = await engine.tick();
    if (r.posts || r.chases) console.log(D(`  [tick] ${JSON.stringify(r)}`));
  } catch (e) { console.log(D(`  [tick failed] ${e.message}`)); }
}, 60_000);

let offset = 0;
for (;;) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates` +
      `?timeout=25&offset=${offset}&allowed_updates=` +
      encodeURIComponent(JSON.stringify(['message', 'my_chat_member'])),
    );
    const { ok, result, description } = await res.json();
    if (!ok) { console.log(D(`  [poll] ${description}`)); await sleep(3000); continue; }

    for (const u of result) {
      offset = u.update_id + 1;
      const who = u.message?.from?.first_name ?? 'someone';
      const where = u.message?.chat?.type === 'private' ? 'DM' : 'group';
      if (u.message?.text) {
        console.log(`${IN(`← ${who} (${where})`)}\n${indent(u.message.text)}\n`);
      } else if (u.my_chat_member) {
        console.log(D(`  [membership] ${u.my_chat_member.chat.id} -> ` +
                      `${u.my_chat_member.new_chat_member.status}`));
      }
      try {
        const r = await flow.route(u);
        if (r?.handled && r.handled !== 'engine') console.log(D(`  [${r.handled}]`));
      } catch (e) {
        console.log(D(`  [error] ${e.message}`));
        console.error(e);
      }
    }
  } catch (e) {
    console.log(D(`  [network] ${e.message}`));
    await sleep(3000);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
