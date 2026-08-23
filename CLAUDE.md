# Call Her — how it is built

`README.md` is Aidan's original post, which is the product brief and stays
verbatim. This file is the engineering side: what got built from it, why, and
the rules that have teeth. Claude Code loads it automatically in this repo.

You already text two friends after a first date. This makes it a group chat, and
two weeks later asks you what you did.

Free, and it stays free.

**Read `README.md` before changing behaviour, not just before changing copy.**
It is the brief, it outranks this file, and on 2026-08-23 the first build got
its central mechanic backwards — see "The premise, and the way it was got
wrong" below.

**There is no app and no product UI.** The whole thing lives in Messages. The
website exists to explain it, take your number, and hand you one line to paste
into the group chat you already have.

## The loop

```
You  ->  Dinner at Owamni with the one who ordered the whole fish.

Us   ->  Going to your 4. Their replies as they come, or should I
         ask them to let you decide first?  Reply NOW or WAIT.

You  ->  wait

[in the group, immediately]
Us   ->  Aidan, after a first date:
         "Dinner at Owamni with the one who ordered the whole fish."

         Aidan isn't reading this till Sun Sep 6 — talk among
         yourselves.

         ... 14 days ...

Us   ->  Two weeks. Your turn — what happened? One line is plenty.
```

**The entry always goes to the room.** `NOW` and `WAIT` choose what the room is
*told*, never whether it is told: `WAIT` posts the same entry with the hold
stated where the whole room can see it. Two weeks later — his brief's number —
the bot asks **him**, privately, for his one update, and posts his words.

## The premise, and the way it was got wrong

The first build (same day, commits `7c985c9`..`5afda0c`) inverted the mechanic,
and Aidan caught it. Worth keeping, because every wrong line came from the same
single misreading:

| The brief says | The first build did |
|---|---|
| "you will see your buddies **replies** … 1 week later" — the delay is on **him** | `WAIT` hid the **entry from them** for a week. The group chat sat empty. |
| "locked out for **2 weeks** before they can give the 'what happened'" | 7 days. |
| "the creator **is allowed to give** one update" | the bot asked the room *"— did you call her?"* |
| "**Journaling is good.** … primarily geared at improving things" | *"The journaling is the hook. The day-7 question is the mechanism."* |
| "I wanna fuel **creative discourse** … small group discussions" | in `WAIT` mode there was nothing to discuss for a week. |

**The rule that falls out: the group chat is the product.** An entry that does
not reach the room is the one outcome this cannot produce, and
`test/machine.test.js` + `test/integration.test.js` both pin it in either mode.

**And the honest limit, stated in the copy rather than papered over:** he is a
member of that room, so no code can withhold his friends' replies from him. The
hold is a norm the room can see and honour. What actually stops him being talked
out of it is the two-week lock on his update — he has to act before he reports.
Chosen by Aidan 2026-08-23 over the two enforceable alternatives (friends DM the
bot for a week; or a room he is not in), because both cost the one group chat
that made this worth building.

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

The simulator runs `lib/engine.js` — the exact path production takes. Five
defects have come out of drives that no unit test would have found — including a
hold date printed two weeks in the past, because the machine was reading the
entry's `created_at` and the store stamps that from the real clock rather than
the injected one. See `git log`.

`lib/machine.js` is pure — no network, no database, no clock beyond an injected
`now`. Every consequence comes back as a declarative effect. This is deliberate:
everything that can go wrong in this product is a sequencing bug (a question
that fires twice, an entry posted to a circle of zero, an entry whose mode was
never answered and so never landed), and none of those are testable against a
live phone network and a two-week timer.

```
npm test        # 61 tests, no network, instant
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
npm test                          # 61, free, instant
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
