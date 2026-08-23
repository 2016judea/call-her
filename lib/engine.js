// Assembles context, runs the machine, performs the result.
//
// This is the whole request path. `api/sms.js` and the simulator are both thin
// shims over it, on purpose — a simulator that exercised its own copy of this
// logic would prove nothing about what ships.

import { machine, S } from './machine.js';
import { classify } from './keywords.js';
import { createEffects } from './effects.js';

const MIN_ENTRY_CHARS = 25;   // mirrors lib/machine.js

/**
 * @param {object} io
 *   db      — query surface (lib/db.js, or sim/memory-db.js)
 *   channel — lib/twilio.js, lib/telegram.js, or sim/console-channel.js
 *   scrub   — async (body) => {clean, removedNames, explicit}
 *   now     — () => Date  (injectable so the simulator can jump a week)
 */
export function createEngine({ db, channel, scrub, now = () => new Date() }) {
  const { apply, deliver } = createEffects({ db, channel });

  async function run(ctx, event) {
    const result = machine(ctx, event);
    await apply(result.effects);
    await deliver(result.replies);
    return result;
  }

  /** One inbound message. */
  async function inbound(from, body) {
    await db.logMessage('in', from, body);
    const ctx = await context(from, body);
    return run(ctx, { type: 'sms', from, body });
  }

  /** The daily pass: held entries come due, day-7 questions fire. */
  async function tick() {
    const at = now();
    const base = { now: at, ourNumber: channel.ourNumber };
    const done = { posts: 0, chases: 0, errors: [] };

    for (const entry of await db.duePosts(at)) {
      try {
        const author = await db.findUserById(entry.author_id);
        if (!author || author.stopped_at) continue;
        await run({ ...base }, { type: 'due_post', entry, author });
        done.posts++;
      } catch (err) {
        done.errors.push(`post:${entry.id}: ${err.message}`);
      }
    }

    for (const entry of await db.dueChases(at)) {
      try {
        const author = await db.findUserById(entry.author_id);
        if (!author || author.stopped_at) continue;
        await run({ ...base }, { type: 'due_chase', entry, author });
        done.chases++;
      } catch (err) {
        done.errors.push(`chase:${entry.id}: ${err.message}`);
      }
    }
    return done;
  }

  /** Everything the machine needs to decide, read once, up front. */
  async function context(from, body) {
    const msg = classify(body);
    const user = await db.findUserByPhone(from);

    const invite = await db.findPendingInvite(from);
    let inviteOwner = null;
    if (invite) {
      inviteOwner = await db.findUserById(invite.owner_id);
      invite.circleCountAfter = (await db.countActiveCircle(invite.owner_id)) + 1;
    }

    let codeOwner = null, codeOwnerCircleCount = 0;
    if (msg.kind === 'join') {
      codeOwner = await db.findUserByCode(msg.code);
      if (codeOwner) codeOwnerCircleCount = await db.countActiveCircle(codeOwner.id);
    }

    const activeCircle = user ? await db.activeCircle(user.id) : [];
    const openEntry    = user ? await db.openEntry(user.id) : null;

    // The guard runs only on text that is actually about to become an entry.
    // Everything else skips the model call — cheaper, faster, and it means
    // STOP never depends on an API being reachable.
    let scrubbed = null;
    const isEntry = user && user.state === S.READY
      && msg.kind === 'text' && msg.body.length >= MIN_ENTRY_CHARS;
    if (isEntry) scrubbed = await scrub(msg.body);

    return {
      now: now(),
      ourNumber: channel.ourNumber,
      user, invite, inviteOwner, codeOwner, codeOwnerCircleCount,
      activeCircle, openEntry, scrub: scrubbed,
    };
  }

  return { inbound, tick, context, run };
}
