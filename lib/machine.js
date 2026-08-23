// The whole product's decision-making, as one pure function.
//
// No network, no database, no clock — `ctx.now` is injected. Every consequence
// comes back as a declarative effect for an adapter to perform.
//
// Why pure: everything that can go wrong here is a sequencing bug — a chase
// that fires twice, an entry posted into an empty circle, a held entry that
// never lands. Those are untestable against a live Twilio account and a
// seven-day timer, and trivially testable against this.

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
export const HOLD_DAYS = 7;
const MIN_ENTRY_CHARS = 25;

const plus = (now, days) => new Date(now.getTime() + days * DAY);
const when = (d) =>
  d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });

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

  if (event.type === 'due_post') {
    const { entry, author } = event;
    // A held entry comes due. Ask for the outcome first; the entry and what
    // he actually did land in the room together, which is the whole point of
    // having held it.
    if (!entry.outcome) {
      doIt({ type: 'mark_outcome_asked', entryId: entry.id });
      doIt({ type: 'set_state', userId: author.id, state: S.AWAITING_OUTCOME });
      say(author.phone, copy.askOutcome());
      return out;
    }
    doIt({ type: 'post_entry', entryId: entry.id, ownerId: author.id,
           body: copy.groupEntryWithOutcome(author.handle, entry.body, entry.outcome) });
    return out;
  }

  if (event.type === 'due_chase') {
    const { entry, author } = event;
    doIt({ type: 'mark_chased', entryId: entry.id });
    doIt({ type: 'group', ownerId: author.id, body: copy.chaseGroup(author.handle) });
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

  // Joining someone's circle.
  if (msg.kind === 'join') {
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
      say(from, copy.handleSet(handle, u.join_code, ctx.ourNumber));
      return out;
    }

    case S.BUILDING_CIRCLE: {
      // No room to post into yet. Say so rather than swallowing the entry.
      say(from, copy.noCircleYet(u.join_code, ctx.ourNumber));
      return out;
    }

    case S.READY: {
      if (msg.kind !== 'text') { say(from, copy.tooShort()); return out; }
      if (msg.body.length < MIN_ENTRY_CHARS) { say(from, copy.tooShort()); return out; }

      // Guard 2: explicit content is refused, never quietly filtered. One
      // SHAFT flag takes the number down for every user at once.
      if (ctx.scrub?.explicit) { say(from, copy.refusedExplicit()); return out; }

      doIt({ type: 'create_entry', userId: u.id,
             raw: msg.body, clean: ctx.scrub?.clean ?? msg.body });
      doIt({ type: 'set_state', userId: u.id, state: S.AWAITING_MODE });
      const n = ctx.scrub?.removedNames?.length ?? 0;
      if (n) say(from, copy.scrubbedNames(n));
      say(from, copy.askMode(ctx.activeCircle.length));
      return out;
    }

    case S.AWAITING_MODE: {
      if (msg.kind === 'now') {
        const chaseAt = plus(ctx.now, HOLD_DAYS);
        doIt({ type: 'set_entry_mode', entryId: ctx.openEntry.id, mode: 'now',
               postAt: ctx.now, chaseAt });
        doIt({ type: 'post_entry', entryId: ctx.openEntry.id, ownerId: u.id,
               body: copy.groupEntry(u.handle, ctx.openEntry.body) });
        doIt({ type: 'set_state', userId: u.id, state: S.READY });
        say(from, copy.modeNow(when(chaseAt)));
        return out;
      }
      if (msg.kind === 'wait') {
        const postAt = plus(ctx.now, HOLD_DAYS);
        doIt({ type: 'set_entry_mode', entryId: ctx.openEntry.id, mode: 'wait',
               postAt, chaseAt: null });
        doIt({ type: 'set_state', userId: u.id, state: S.READY });
        say(from, copy.modeWait(when(postAt)));
        return out;
      }
      say(from, copy.nudgeMode());
      return out;
    }

    case S.AWAITING_OUTCOME: {
      if (msg.kind !== 'text') { say(from, copy.askOutcome()); return out; }
      doIt({ type: 'set_outcome', entryId: ctx.openEntry.id, outcome: msg.body });
      doIt({ type: 'post_entry', entryId: ctx.openEntry.id, ownerId: u.id,
             body: copy.groupEntryWithOutcome(u.handle, ctx.openEntry.body, msg.body) });
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
