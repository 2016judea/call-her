// The whole product's decision-making, as one pure function.
//
// No network, no database, no clock — `ctx.now` is injected. Every consequence
// comes back as a declarative effect for an adapter to perform.
//
// Why pure: everything that can go wrong here is a sequencing bug — an update
// asked for twice, an entry posted into an empty circle, an entry whose mode
// was never answered and so never landed. Those are untestable against a live
// Twilio account and a two-week timer, and trivially testable against this.

import { classify, makeJoinCode } from './keywords.js';
import { copy, MAX_CIRCLE } from './copy.js';
import { pretty } from './phone.js';

export const S = {
  AWAITING_HANDLE:  'awaiting_handle',
  BUILDING_CIRCLE:  'building_circle',
  READY:            'ready',
  AWAITING_MODE:    'awaiting_mode',
  AWAITING_OUTCOME: 'awaiting_outcome',
  STOPPED:          'stopped',
};

const DAY = 24 * 60 * 60 * 1000;

// The entry ALWAYS goes to the room. These two clocks are the only delays, and
// neither of them holds the journal back — that was the mistake this file used
// to make. `QUIET_DAYS` is how long the room is asked to talk without him;
// `OUTCOME_DAYS` is his brief's "locked out for 2 weeks before they can give
// the 'what happened'".
export const QUIET_DAYS = 7;
export const OUTCOME_DAYS = 14;
// If he never answers NOW or WAIT, the entry still goes in — after this long.
export const MODE_GRACE_DAYS = 1;

const MIN_ENTRY_CHARS = 25;

const plus = (now, days) => new Date(now.getTime() + days * DAY);
// A bare weekday name a week or more out is ambiguous — "Sunday" reads as the
// Sunday that is two days away. Always carry the date.
const when = (d) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago',
  }).replace(',', '');   // "Sun Aug 30" reads better in a text than "Sun, Aug 30"


const reply = (to, body) => ({ to, body });

/**
 * @param {object} ctx
 *   now            {Date}
 *   ourNumber      {string}
 *   user           {object|null}  sender, if they are a creator we know
 *   invite         {object|null}  a pending invite addressed to the sender
 *   inviteOwner    {object|null}  the creator who sent that invite
 *   codeOwner      {object|null}  creator matching a `join xxxx` code
 *   codeOwnerCircleCount {number}
 *   activeCircle   {array}        sender's own active circle members
 *   openEntry      {object|null}  sender's entry awaiting a mode or an outcome
 *   scrub          {object|null}  {clean, removedNames:[], explicit:bool} for text
 * @param {object} event  {type:'sms', from, body} | {type:'due_post'|'due_chase', entry, author}
 * @returns {{replies: Array, effects: Array}}
 */
export function machine(ctx, event) {
  const out = { replies: [], effects: [] };
  const say = (to, body) => out.replies.push(reply(to, body));
  const doIt = (e) => out.effects.push(e);

  // ---------- cron-driven events ----------

  // An entry whose NOW-or-WAIT question was never answered. It goes to the room
  // anyway, in the open form. A journal that reached nobody is the one outcome
  // this product must never produce, and leaving him in AWAITING_MODE also
  // wedges him: every later entry would come back as "NOW or WAIT."
  if (event.type === 'due_post') {
    const { entry, author } = event;
    doIt({ type: 'set_entry_mode', entryId: entry.id, mode: 'now' });
    doIt({ type: 'post_entry', entryId: entry.id, ownerId: author.id,
           body: copy.groupEntry(author.handle, entry.body) });
    doIt({ type: 'set_state', userId: author.id, state: S.READY });
    say(author.phone, copy.modeLapsed(when(
      entry.chase_at ? new Date(entry.chase_at) : plus(ctx.now, OUTCOME_DAYS))));
    return out;
  }

  // Two weeks on. His brief gives the creator ONE update, and it is his to give
  // — so this is asked of him privately, never of the room. An earlier version
  // posted "did you call her?" into the group, which turned a journal into an
  // interrogation and was not what was asked for.
  if (event.type === 'due_chase') {
    const { entry, author } = event;
    doIt({ type: 'mark_chased', entryId: entry.id });
    doIt({ type: 'mark_outcome_asked', entryId: entry.id });
    doIt({ type: 'set_state', userId: author.id, state: S.AWAITING_OUTCOME });
    say(author.phone, copy.askOutcome());
    return out;
  }

  // ---------- inbound SMS ----------

  const { from, body } = event;
  const msg = classify(body);

  // Compliance first. STOP can never be shadowed by application state — a
  // user replying STOP while we await NOW/WAIT is opting out, not choosing.
  if (msg.kind === 'stop') {
    doIt({ type: 'stop', phone: from });
    say(from, copy.stopped());
    return out;
  }
  if (msg.kind === 'help') {
    say(from, copy.help(ctx.ourNumber));
    return out;
  }
  if (msg.kind === 'start') {
    doIt({ type: 'restart', phone: from });
    say(from, copy.restarted());
    return out;
  }

  // A pending invite outranks everything else this number could be doing:
  // until they answer, we have no consent to send them anything else.
  if (ctx.invite && ctx.invite.status === 'pending') {
    if (msg.kind === 'yes') {
      doIt({ type: 'activate_invite', ownerId: ctx.invite.owner_id, phone: from });
      doIt({ type: 'add_to_room', ownerId: ctx.invite.owner_id, phone: from });
      say(from, copy.inviteAccepted(ctx.inviteOwner.handle));
      say(ctx.inviteOwner.phone,
          copy.circleGrew(pretty(from), ctx.invite.circleCountAfter));
      return out;
    }
    if (msg.kind === 'no') {
      doIt({ type: 'decline_invite', ownerId: ctx.invite.owner_id, phone: from });
      say(from, copy.inviteDeclined());
      return out;
    }
    say(from, copy.inviteSent(ctx.inviteOwner.handle));
    return out;
  }

  // Joining someone's circle by code. Only channels that can put a person into
  // a room support this — on Telegram a bot cannot add anyone, so following
  // this path would have thrown inside createRoom.
  if (msg.kind === 'join') {
    if (!ctx.canInviteByCode) { say(from, copy.cantInviteHere(ctx.invite_how)); return out; }
    if (!ctx.codeOwner) { say(from, copy.badCode()); return out; }
    if (ctx.codeOwner.phone === from) { say(from, copy.badCode()); return out; }
    if (ctx.codeOwnerCircleCount >= MAX_CIRCLE) {
      say(from, copy.circleFull(ctx.codeOwner.handle));
      return out;
    }
    doIt({ type: 'create_invite', ownerId: ctx.codeOwner.id, phone: from });
    say(from, copy.inviteSent(ctx.codeOwner.handle));
    return out;
  }

  // A number we've never seen, that isn't joining anyone, becomes a creator.
  if (!ctx.user) {
    doIt({ type: 'create_user', phone: from, joinCode: makeJoinCode(ctx.random) });
    say(from, copy.welcome());
    return out;
  }

  const u = ctx.user;

  switch (u.state) {
    case S.AWAITING_HANDLE: {
      if (msg.kind !== 'text') { say(from, copy.nudgeHandle()); return out; }
      const handle = msg.body.split(/\s+/)[0].slice(0, 24);
      doIt({ type: 'set_handle', userId: u.id, handle });
      doIt({ type: 'set_state', userId: u.id, state: S.BUILDING_CIRCLE });
      say(from, copy.handleSet(handle, ctx.invite_how));
      return out;
    }

    case S.BUILDING_CIRCLE: {
      // No room to post into yet. Say so rather than swallowing the entry.
      say(from, copy.noCircleYet(ctx.invite_how));
      return out;
    }

    case S.READY: {
      // A circle can drain after the fact — every member can reply STOP. Being
      // "ready" once is not a promise that there is still anyone to post to.
      if (ctx.activeCircle.length === 0) {
        doIt({ type: 'set_state', userId: u.id, state: S.BUILDING_CIRCLE });
        say(from, copy.noCircleYet(ctx.invite_how));
        return out;
      }
      if (msg.kind !== 'text') { say(from, copy.tooShort()); return out; }
      if (msg.body.length < MIN_ENTRY_CHARS) { say(from, copy.tooShort()); return out; }

      // Guard 2: explicit content is refused, never quietly filtered. One
      // SHAFT flag takes the number down for every user at once.
      if (ctx.scrub?.explicit) { say(from, copy.refusedExplicit()); return out; }

      // Both clocks start at the date, not at whenever he answers the next
      // question — so a slow reply cannot push his update into week three.
      doIt({ type: 'create_entry', userId: u.id,
             raw: msg.body, clean: ctx.scrub?.clean ?? msg.body,
             postAt: plus(ctx.now, MODE_GRACE_DAYS),
             chaseAt: plus(ctx.now, OUTCOME_DAYS) });
      doIt({ type: 'set_state', userId: u.id, state: S.AWAITING_MODE });
      const n = ctx.scrub?.removedNames?.length ?? 0;
      if (n) say(from, copy.scrubbedNames(n));
      say(from, copy.askMode(ctx.activeCircle.length));
      return out;
    }

    // NOW and WAIT choose what the ROOM is told, not whether it is told. The
    // entry lands either way: the group chat is the product, and a week of
    // silence in it is the one thing that cannot happen.
    case S.AWAITING_MODE: {
      const e = ctx.openEntry;
      // `chase_at` is written when the entry is created. The fallback covers a
      // row from before that was true; nothing in the store predates it today.
      const outcomeAt = e.chase_at
        ? new Date(e.chase_at) : plus(ctx.now, OUTCOME_DAYS);
      // Hang the quiet window off the SAME anchor, so the room is never told a
      // hold date that disagrees with the update date. Deliberately not derived
      // from `e.created_at`: the store stamps that with its own wall clock, not
      // the injected one, so reading it made the simulator print a date two
      // weeks in the past (found by driving it, 2026-08-23).
      const quietUntil = plus(outcomeAt, QUIET_DAYS - OUTCOME_DAYS);
      if (msg.kind === 'now') {
        doIt({ type: 'set_entry_mode', entryId: e.id, mode: 'now' });
        doIt({ type: 'post_entry', entryId: e.id, ownerId: u.id,
               body: copy.groupEntry(u.handle, e.body) });
        doIt({ type: 'set_state', userId: u.id, state: S.READY });
        say(from, copy.modeNow(when(outcomeAt)));
        return out;
      }
      if (msg.kind === 'wait') {
        // He is in this room — no code can stop him reading it. So the hold is
        // a norm the whole room can see, stated in the post itself, and the
        // copy never claims to enforce it. His decision by then is what the
        // two-week lock on the update actually protects.
        doIt({ type: 'set_entry_mode', entryId: e.id, mode: 'wait' });
        doIt({ type: 'post_entry', entryId: e.id, ownerId: u.id,
               body: copy.groupEntryHeld(u.handle, e.body, when(quietUntil)) });
        doIt({ type: 'set_state', userId: u.id, state: S.READY });
        say(from, copy.modeWait(when(quietUntil), when(outcomeAt)));
        return out;
      }
      say(from, copy.nudgeMode());
      return out;
    }

    // The entry has been in the room for two weeks. This adds his one update
    // to it, so `group` and not `post_entry` — the entry is already posted.
    case S.AWAITING_OUTCOME: {
      if (msg.kind !== 'text') { say(from, copy.askOutcome()); return out; }
      doIt({ type: 'set_outcome', entryId: ctx.openEntry.id, outcome: msg.body });
      doIt({ type: 'group', ownerId: u.id,
             body: copy.groupOutcome(u.handle, msg.body) });
      doIt({ type: 'set_state', userId: u.id, state: S.READY });
      say(from, copy.posted());
      return out;
    }

    case S.STOPPED:
      // They opted out; only START (handled above) brings them back. Silence
      // is the correct response to anything else.
      return out;

    default:
      return out;
  }
}
