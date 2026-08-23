# Call Her — design

`2026-08-23` · grounded in the session that specified it, from Aidan's Substack draft

## What it is

You text a number after a first date. It posts your journal entry to a group
text with the handful of friends you'd have texted anyway. A week later it asks
you, in front of them, whether you called her.

Free, public benefit. The point is not the journaling — it is that a bot asks
you in front of your friends. Journaling is the hook; **the day-7 question is
the mechanism.**

## The interface is text messages. There is no app and no product UI.

The website's only jobs are (a) explain it, (b) collect the creator's number,
(c) hand them one line to paste into the group chat they already have. Everything
after that happens in Messages.

Rejected: a mobile app (install friction against a free tool nobody has heard
of), a web UI for reading entries (a second place to check, competing with the
thread), and **contact sync** — the Contact Picker API is Chrome-on-Android
only and sits behind an off-by-default experimental flag on iOS Safari. A
webpage cannot read an iPhone address book, so the creator forwards a join
line instead. This is strictly better: the buddy's inbound text is the consent
record that carrier rules require anyway.

## The loop

> **SUPERSEDED, same day.** What this section originally specified is kept below
> struck through, because it is the most useful thing in this document: it is a
> record of reading the brief wrong in a way that felt entirely reasonable.
> Aidan's correction and the shipped design are in `CLAUDE.md` under "The
> premise, and the way it was got wrong".
>
> ~~`WAIT` holds the entry 7 days so nobody talks you out of your decision, then
> posts entry + outcome together. `WAIT` is the thesis: your friends cannot talk
> you out of a call you have already made.~~
>
> The brief says the opposite. The delay is on **him seeing their replies**
> ("If you have opted out you will see them 1 week later"), not on **them seeing
> the entry**. Holding the entry back empties the group chat, and the group chat
> is the product — "you basically already do this when you text your two
> friends. Why not make it a group chat?" It also erased the thing he said he
> was really after: "I wanna fuel creative discourse… small group discussions."
>
> The tell I missed: the brief contains **two different delays** — a one-week
> one on the replies and a two-week one on the update — and I collapsed them
> into a single seven-day hold on the wrong object.

    1. You text your entry.                          (that night)
    2. It asks: NOW or WAIT.
    3. The entry goes to the room EITHER WAY. The mode only changes what the
       room is told:
         NOW  -> posted plainly; their replies land as they come.
         WAIT -> posted with the hold stated in the post itself, so the people
                 who can honour it can see it.
    4. Day 14 -> it asks HIM, privately, for his one update, and posts his words.

He is a member of that room, so no code can withhold their replies from him;
the copy says so rather than pretending otherwise. What actually protects the
decision is the two-week lock on the update — he acts, then reports. Aidan chose
this on 2026-08-23 over two enforceable alternatives (friends DM the bot for the
first week; or a room he is not in), both of which cost the single group chat
that made this worth building.

## Architecture

One standing group per creator. Not one room per date.

**Why:** Twilio's Conversations group texting caps at 10 participants on US/CA
long codes, and enforces a uniqueness constraint on participant-to-number
mappings (error 50425). Group-MMS SMS participants carry no proxy address and
the docs do not say how the constraint applies to them, so per-date rooms —
many concurrent conversations sharing one Twilio number and one participant set
— bet the product on undocumented routing. One durable room per creator has a
stable participant set, one number, and no collision surface. Both modes are
then just a **post** into an existing room, differing only in what the post
says.

The cost: all of a creator's dates land in one thread rather than threading per
date. Acceptable, and closer to the group chat this replaces.

    Twilio inbound  ->  api/sms.js   ->  lib/machine.js (pure)  ->  effects
    daily 17:00 UTC ->  api/cron.js  ->  lib/machine.js (pure)  ->  effects
    landing page    ->  api/signup.js

`lib/machine.js` is a pure function — `(context, inbound) => {replies, effects}`.
It touches no network and no clock beyond an injected `now`. Everything that can
be wrong about this product is a sequencing bug (an update asked for twice, an
entry posted to a circle of zero, a mode question that goes unanswered and
strands the entry), and a pure core is the only way to test those without
waiting two weeks. The adapters
(`lib/db.js`, `lib/twilio.js`, `lib/scrub.js`) hold all the I/O and no decisions.

## Rules with teeth

These are the ones where a mistake is expensive, so they are explicit.

1. **Never a full name.** Every entry passes through Claude before it is posted;
   detected names are replaced with a handle. *Why:* she did not sign up for
   this. It is also the only reason the concept survives contact with anyone
   outside the circle.
2. **Explicit content is refused, not filtered.** *Why:* US carriers block
   SHAFT content, and a violation does not fine you — it kills the number for
   every user at once.
3. **A buddy is only in a circle after they text us.** No number is ever added
   from a form. *Why:* inbound consent is the record carriers require, and the
   alternative is texting strangers.
4. **The registered use case is journaling and small-group accountability, and
   the public site never says "dating."** *Why:* campaign vetting rejects a
   linked site hosting "pornographic, escort, dating, or adult entertainment
   content" (error 30953) and that rejection **cannot be resubmitted**. See
   `docs/COMPLIANCE.md`. All of the swagger belongs on Substack, which no
   carrier reads.
5. **Register the brand away from any existing business.** *Why:* rejection
   patterns follow the tax ID (error 30898), and one bad submission should not
   be able to touch an unrelated company's ability to send texts.
6. **STOP wins, always, before any other parsing and before any model call.**

## Not in v1

One-update enforcement (the "you get one 'what happened'" rule is a social
norm in the thread, not code), reactions or voting, more than 9 circle members
(the carrier caps it at 10 including us), and any web view of past entries.
