# Call Her

You text it after a first date. It puts your entry in a group text with the few
friends you'd have told anyway. A week later it asks you, in front of them,
whether you called her.

Free, and it stays free.

**There is no app and no product UI.** The whole thing lives in Messages. The
website exists to explain it, take your number, and hand you one line to paste
into the group chat you already have.

## The loop

```
You  ->  Coffee at Spyhouse with the architect. Talked three hours.

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
lib/twilio.js     the only channel-specific file in the repo
lib/db.js         queries, no decisions
lib/effects.js    performs what the machine decided
api/sms.js        Twilio inbound webhook
api/cron.js       daily: held entries come due, day-7 questions fire
api/signup.js     the landing page's one endpoint
public/index.html the site
```

`lib/machine.js` is pure — no network, no database, no clock beyond an injected
`now`. Every consequence comes back as a declarative effect. This is deliberate:
everything that can go wrong in this product is a sequencing bug (a question
that fires twice, an entry posted to a circle of zero, a held entry that never
lands), and none of those are testable against a live phone network and a
seven-day timer.

```
npm test        # 27 tests, no network, instant
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

## Running it

```bash
cp .env.example .env        # Twilio, Neon, Anthropic, a cron secret
psql "$DATABASE_URL" -f db/schema.sql
npm install && npm test
vercel dev
```

Point the Twilio number's inbound webhook at `POST /api/sms`. The daily job is
declared in `vercel.json` and runs at 17:00 UTC (noon Central).

Design notes: [`docs/superpowers/specs/2026-08-23-call-her-design.md`](docs/superpowers/specs/2026-08-23-call-her-design.md)

MIT.
