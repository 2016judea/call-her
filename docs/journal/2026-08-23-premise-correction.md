# The premise was inverted, and it took one line of his own brief to see it

2026-08-23, hours after the build journal next to this file. Aidan read the
product's own description back to us and said: *"this was not the
premise/purpose of this project."* He was right, and the copy line he quoted was
the smallest part of it — the machine was wrong too.

## What he quoted

> "Text it how the date went. It lands in a group chat with the two friends
> you'd have told anyway — and a week later it asks, in front of them, if you
> called."

Which is the card on his projects page, and near-verbatim the landing page lede
and `CLAUDE.md`'s own summary. Three surfaces, one misreading underneath all of
them.

## The diff against the brief

`README.md` is his post and had not changed. Reading it against what shipped:

| The brief | The build |
|---|---|
| "you will see your buddies **replies** … 1 week later" — the delay is on **him** | `WAIT` held **the entry from them** for a week. The group chat sat empty. |
| "locked out for **2 weeks** before they can give the 'what happened'" | 7 days. |
| "the creator **is allowed to give** one update" — a right he holds | the bot posted *"— did you call her?"* into the room. |
| "**Journaling is good.** … primarily geared at improving things" | `CLAUDE.md`: *"The journaling is the hook. The day-7 question is the mechanism."* |
| "I wanna fuel **creative discourse** … small group discussions" | in `WAIT` mode there was nothing to discuss for a week. |

**The single root cause: the brief contains two different delays** — one week on
the replies, two weeks on the update — **and the build collapsed them into one
seven-day hold on the wrong object.** Everything else followed from that. Once
the entry is being held back, the mechanism has to be something other than the
journal reaching friends, so the doc reached for shame ("asked in front of your
friends") and wrote a sentence that flatly contradicts "journaling is good".

Worth naming that the wrong version was *coherent*. `docs/superpowers/specs/`
argued it confidently — *"`WAIT` is the thesis: your friends cannot talk you out
of a call you have already made."* An internally consistent misreading does not
feel like a misreading from the inside. What would have caught it was reading
the brief for **numbers and objects** — 1 week vs 2 weeks, replies vs entry —
rather than for intent.

## The one thing that genuinely needed him

His literal design cannot be enforced on this channel: he is a member of the
group chat, so nothing can withhold his friends' replies from him. Three ways
out, and it is a premise decision, not an implementation detail:

1. the entry always posts; the hold is a **norm stated in the post** the whole
   room can see, and the copy never claims to enforce it;
2. friends reply to the bot in DM for the first week and it dumps the thread
   into the group when the window opens — enforceable, but every friend has to
   `/start` the bot, and the room is silent for that week anyway;
3. the room is the friends' and he is not in it — but a bot cannot create a
   Telegram group, so he would have to make it and leave.

**He chose 1.** It keeps the single group chat, keeps the discourse immediate,
and is honest about what it is. The real protection against being talked out of
it is the two-week lock: he has to act before he can report.

## What shipped

- The entry **always** reaches the room. `NOW` and `WAIT` change what the room
  is *told*, never whether it is told. Pinned in `machine.test.js` and
  `integration.test.js` in both modes, with the reason in the test names.
- `OUTCOME_DAYS = 14`, his number. `QUIET_DAYS = 7`, the stated hold.
- The two-week question is a **DM to him**, never a post to the room. A test
  asserts nothing at all is said to the room at that moment.
- His update posts as his own words and closes the entry. One update.
- New: an unanswered `NOW`/`WAIT` no longer strands the entry *or* wedges him.
  It posts open after a day. Before this, an ignored question left him in
  `AWAITING_MODE` where every later entry came back as "NOW or WAIT." forever —
  a pre-existing hole, found while re-reading the state machine.

## The defect the simulator caught, again

Driving it printed a hold date **two weeks in the past**. Cause: the machine was
deriving the hold from the entry's `created_at`, and the store stamps that
column from the real wall clock, not the engine's injected `now`. Under a jumped
clock it lies.

Fix: hang both dates off `chase_at` — the one the machine itself wrote — so
`quietUntil = chase_at - 7d` and the two dates can never disagree. The rule is
now a comment in `sim/memory-db.js` where it will be read: **the machine must
never decide or print from a store-stamped timestamp.**

That is the fifth defect these drives have produced and the second that no unit
test would have reached. `npm run sim` earns its keep every single time.

## State

61 free tests, 6 live guard tests, all green. `npm run test:live` now reads
`.env` itself — `CLAUDE.md` told the next session to run it and the script
silently skipped all six without a key.
