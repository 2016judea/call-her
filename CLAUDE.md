# Call Her — how it is built

`README.md` is Aidan's original post, which is the product brief and stays
verbatim. This file is the engineering side: what got built from it, why, and
the rules that have teeth. Claude Code loads it automatically in this repo.

You text it after a first date. It puts your entry in a group text with the few
friends you'd have told anyway. A week later it asks you, in front of them,
whether you called her.

Free, and it stays free.

**There is no app and no product UI.** The whole thing lives in Messages. The
website exists to explain it, take your number, and hand you one line to paste
into the group chat you already have.

## The loop

```
You  ->  Dinner at Owamni with the one who ordered the whole fish.

Us   ->  Got it. Open it to your 4 now, or hold it a week so you
         decide first?  Reply NOW or WAIT.

You  ->  wait

Us   ->  Held. Your circle sees it Sunday — until then the call is
         yours alone.

         ... 7 days ...

Us   ->  Your entry goes to the circle today. Before it does:
         what happened?
```

`NOW` opens it immediately and, seven days later, asks the group whether you
called. `WAIT` holds the entry for a week so nobody can talk you out of a
decision you haven't made yet, then posts the entry and the outcome together.

The journaling is the hook. **The day-7 question is the mechanism.**

## Layout

```
lib/machine.js    the entire product's logic, as one pure function
lib/keywords.js   inbound classification (STOP wins, always)
lib/copy.js       every outbound string, in one file
lib/scrub.js      the guard: names out, explicit content refused
lib/engine.js     the whole request path: context -> machine -> effects
lib/effects.js    performs what the machine decided
lib/blob-db.js    the LIVE store: one JSON doc in Vercel Blob, CAS transactions
lib/snapshot.js   JSON round-trip; revives dates so held entries still come due
lib/db.js         the Postgres store (same contract, unused while Telegram ships)
lib/twilio.js     channel: SMS + group MMS
lib/telegram.js   channel: the fallback, no carrier registration needed
lib/telegram-flow.js  the only channel-specific onboarding in the project
api/telegram.js   Telegram webhook  (LIVE) } thin shims
api/sms.js        Twilio webhook    (dark)  } over
api/cron.js       the daily pass            } lib/engine.js
public/index.html the walkthrough at call-her.vercel.app
bin/local.js      run the real bot off this laptop, no deploy
bin/webhook.js    point the bot at production
sim/              in-memory store + console channel, so the loop can be driven
```

## Drive it

No Twilio, no Postgres, no API key:

```
npm run sim      # scripted: both modes, a week jumped, the guards
npm run repl     # type as any number;  /as <number>  /jump <days>  /state
```

The simulator runs `lib/engine.js` — the exact path production takes. Four
defects came out of the first drive that no unit test would have found; see
`git log`.

`lib/machine.js` is pure — no network, no database, no clock beyond an injected
`now`. Every consequence comes back as a declarative effect. This is deliberate:
everything that can go wrong in this product is a sequencing bug (a question
that fires twice, an entry posted to a circle of zero, a held entry that never
lands), and none of those are testable against a live phone network and a
seven-day timer.

```
npm test        # 49 tests, no network, instant
```

## Rules with teeth

1. **Never a full name.** Every entry passes a model before relay; names of
   other people become handles. *She didn't sign up for this.*
2. **Explicit content is refused, not filtered — and the check fails closed.**
   One SHAFT flag kills the number for every user at once.
3. **Nobody joins a circle without texting us first.** No number is added from
   a form. Inbound consent is the record carriers require.
4. **STOP is handled before all application state and before any model call.**
5. **Read [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) before registering
   anything.** The registration is less reversible than any code here.

## Run the real bot with no infrastructure

```
npm run bot
```

Long-polls `getUpdates` instead of taking a webhook, so it needs no public URL,
no deploy and no Postgres — state lives in `.local-store.json` and survives
restarts. Everything else is production code: the real Bot API, the real content
guard, the same `lib/engine.js` the webhook would call. Enough to put the loop
on real phones before any infrastructure exists.

While it is not running the bot simply does not answer; Telegram queues updates
for about a day and they are picked up on restart.

## Live

- **Site:** https://call-her.vercel.app
- **Bot:** [@callher_bot](https://t.me/callher_bot) → webhook at `/api/telegram`
- **Store:** Vercel Blob (`call-her-store`), one JSON document at
  `call-her/store.json`
- **Daily pass:** `vercel.json` cron, 17:00 UTC (noon Central)

```bash
npx vercel env pull .env.vercel   # BLOB_READ_WRITE_TOKEN
npm test                          # 52, free, instant
npm run test:live                 # 6, needs ANTHROPIC_API_KEY, costs money
npm run bot                       # the real bot, off this laptop
npm run webhook                   # point it back at production
```

**Telegram delivers at least once.** Any update it does not get a 200 for is
retried, so `lib/telegram-flow.js` records each `update_id` and treats a repeat as
a no-op. The mark lands inside the same transaction as the work, so a rolled-back
attempt is retried and a committed one never repeats. Without it, a platform-level
timeout mid-handler posts the entry to the group twice.

`vercel.json` sets `maxDuration` explicitly (60s webhook, 120s cron) rather than
inheriting a default: a real entry spends 2–5s in the content guard plus a blob
read and write, and a timeout is precisely what triggers the retry above.

**`npm run bot` and the deployed webhook are mutually exclusive** — Telegram
delivers to one or the other. `bin/local.js` refuses to start while a webhook is
set, because polling would take production's updates and leave it silently deaf.
`--take-over` overrides, and `npm run webhook` puts it back.

### Why Blob and not Postgres

The data is a few kilobytes and the write rate is a few per person per week.
Vercel Blob is included on Pro, needs no provisioning, no connection pooling and
no cold-start wake. Redis and Postgres are both Marketplace integrations now and
**cannot be created from the API** (`redis` → `not_found`, `postgres` → `gone`,
checked 2026-08-23), so either would have needed a dashboard click.

It is safe because Blob supports conditional writes: `lib/blob-db.js` reads the
document with its ETag, runs the whole update, and commits with `ifMatch`. A
commit that raced another fails and retries against fresh state rather than
clobbering it. **Outbound messages are buffered until the commit lands** — without
that, a retry would text everyone twice.

**Reads are not reliably fresh, and that is handled rather than avoided.** A
public blob is served from the CDN with `cache-control: public, max-age=60` and
`cacheControlMaxAge` cannot go below it, so reading through the returned URL
served content up to a minute old (observed `x-cache: HIT`, `age: 24`). `read()`
therefore uses `get(..., { useCache: false })`, which reads origin **and** returns
the ETag alongside the very bytes it read — a separate `head()` + `fetch()` could
pair an ETag with different content. Even then, origin reads flake: a `get` on a
document that definitely exists returned null once in six back-to-back reads.
That cannot lose data, because a null read carries no ETag, so the commit uses
`ifNoneMatch: '*'`, finds the document present, fails, and retries. The CAS is not
only protecting against concurrent writers — **it is what makes an unreliable read
safe.** `test/blob-store.test.js` pins all of it against a faked blob layer.

`lib/db.js` still implements the identical contract against Postgres, so moving
is one import.

**Two channels.** SMS is the intended one and depends on carrier campaign
approval that can be refused outright — read
[`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) before registering anything.
Telegram needs no registration, no money, and real group chats: make a bot with
@BotFather, point its webhook at `/api/telegram`, and the creator adds it to the
group chat they already have. Both channels run the same engine; only the
onboarding differs, because a bot cannot create a group or add anyone to one.

Design notes: [`docs/superpowers/specs/2026-08-23-call-her-design.md`](docs/superpowers/specs/2026-08-23-call-her-design.md)
What actually happened while building it, including what is still unproven:
[`docs/journal/2026-08-23-build.md`](docs/journal/2026-08-23-build.md)

MIT.
