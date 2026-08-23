# Getting a number that can actually send

`2026-08-23` · every claim below links to Twilio's own error docs. Re-read them
before submitting; carrier policy moves.

Read this before you register anything. **The registration is the highest-risk,
least-reversible step in the whole project** — higher risk than any code in this
repo — and the reason is one line in the vetting rules.

## The rule that decides it

Since Feb 2025, US carriers block unregistered A2P traffic outright, so every
number needs an approved brand and campaign. Two rejection codes matter here:

| Code | Trigger | Resubmit? |
|---|---|---|
| [30953](https://www.twilio.com/docs/api/errors/30953) | sexually explicit / suggestive language, **or a linked website hosting "pornographic, escort, dating, or adult entertainment content"** | **No** |
| [30885](https://www.twilio.com/docs/api/errors/30885) | "high risk" — deceptive marketing, phishing, or a registration pattern that looks fraudulent | **No** |
| [30898](https://www.twilio.com/docs/api/errors/30898) | too many brands on one EIN, or a duplicative-looking registration | Yes, with cause |

`30953` and `30885` are not fixable by editing and resubmitting. You get one
honest attempt.

## What this means, stated plainly

**This site says "first date" and the product is about calling a woman back.
There is a real chance a reviewer keyword-matches that to "dating" and rejects
it, permanently, on the first submission.** I am not going to pretend otherwise,
and I am not going to build you a decoy page that hides the product from the
reviewer — a page that misrepresents what the traffic is *is* the `30885`
pattern, and it would put every number you ever register at risk instead of one.

So: register it honestly, as what it actually is, and know the odds going in.

## How to describe it, truthfully

The service is a **journaling and small-group accountability tool**. That is not
spin — it is the accurate description. Users write a private journal entry, it
is relayed to a group of people who each opted in by text, and the system sends
one follow-up reminder. Dating is the *subject matter users happen to type*, the
way a fitness journal app is not a gym.

Fill the campaign in with that, and with these facts, all of which are true and
all of which are the things vetting actually looks for:

- **Opt-in is inbound only.** Every recipient texts us first — either their own
  number on the site, or `join <code>` to enter someone's circle, followed by an
  explicit `YES`. No number is ever added from a form or a contact list. This is
  the strongest consent record there is; say so.
- **Volume is low and conversational**, not marketing. No promotions, no links
  in the recurring messages, no third parties.
- **STOP works before anything else.** `lib/machine.js` handles STOP / HELP /
  START ahead of all application state and ahead of any model call, so opt-out
  cannot be broken by a bug elsewhere or by an API outage.
- **Explicit content is refused at the door.** `lib/scrub.js` runs every entry
  through a model before it can reach a group text and refuses anything a
  carrier would block under SHAFT. It fails **closed** — if the check cannot
  run, nothing is sent.
- **Names are removed.** Third parties named in an entry are replaced with a
  handle before relay.

## Register the brand away from everything else

Use a **Sole Proprietor** brand in your own name, with no EIN.

**Why:** rejection and risk patterns follow the tax ID ([30898](https://www.twilio.com/docs/api/errors/30898)),
and a single EIN carries a hard cap on brands. If this gets rejected under a
Brick & Mortar registration, the blast radius is a company that has nothing to
do with it. Sole Proprietor is also the correct category — Twilio scopes it to
individuals and hobbyists without a Tax ID, which is exactly what this is.
Throughput is low, and low is plenty for 58 readers.

Do **not** register this under the Brick & Mortar LLC or its EIN.

## Number type

A **+1 US long code.** Not toll-free, not a short code — Twilio's group texting
runs on group MMS and only +1 long codes can exchange it. One number is enough
for the whole system.

## If it gets rejected

Do not resubmit and do not register a second brand to try again — that pattern
is itself what `30898` and `30885` are looking for. Instead the product moves
to a channel with no carrier gatekeeper:

1. **Telegram — already built and tested.** `lib/telegram.js`,
   `lib/telegram-flow.js`, `api/telegram.js`, 11 tests. Free, real group chats,
   no registration, no vetting, nobody's permission. Make a bot with
   @BotFather, point its webhook at `/api/telegram`, done.
2. **A web thread** — worst UX, zero gatekeeping, always available. Not built.

The onboarding differs on Telegram because a bot cannot create a group or add
anyone to one: the creator adds the bot to **the group chat they already have**
with those friends, and sends `/claim` in it. That is closer to the original
idea than SMS is, and consent is implicit — everyone in that room chose to be
in it and can leave it themselves, so there is no invite handshake at all.

Consider running the beta here **first**, regardless of how registration goes.
It costs nothing, it can start today, and it tells you whether the loop is
worth a phone number before you spend one.

## The recurring compliance surface

- `HELP` returns what the service is, that it's free, and how to leave.
- `STOP` removes them from every room and drops the number.
- The footer on `/` carries "message and data rates may apply" and the STOP
  instruction, because the landing page is the opt-in point and vetting reads it.

## Verified / not verified, as of 2026-08-23

| Piece | State |
|---|---|
| `lib/machine.js`, `lib/keywords.js`, `lib/phone.js` | 27 tests, green |
| `lib/scrub.js` | **verified live** against claude-opus-5 — 6 tests, `npm run test:live` |
| `lib/twilio.js` | **not verified** — needs a registered number; group MMS cannot be tested without one |
| Telegram channel | 11 tests over the real flow, green — but never pointed at a live bot |
| Landing page | rendered and read at 390x664 and 1440x900 |

The guard was run against the real model on 2026-08-23 and had two defects that
only showed up there: it invented "the girl from the app" about someone met in
person, then over-corrected and deleted a real detail. Both are pinned by tests
now. Latency is 2-5s per entry, which is fine for a text reply.

What remains unverified is the transport: `lib/twilio.js` needs a registered
number, and the Telegram adapter needs a live bot token. Both are blocked on
paperwork and a 60-second BotFather chat, not on code.
