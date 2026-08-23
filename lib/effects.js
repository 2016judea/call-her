// Performs the effects the machine decided on. Contains no decisions of its
// own — the one exception is noted inline.

import * as db from './db.js';
import * as tw from './twilio.js';
import { copy } from './copy.js';
import { S } from './machine.js';

/** Ensure a creator has a room, creating it (with them in it) on first need. */
async function room(ownerId) {
  const owner = await db.findUserById(ownerId);
  if (owner.conversation_sid) return { owner, sid: owner.conversation_sid };
  const sid = await tw.createRoom(owner.phone, `${owner.handle ?? owner.phone} — Call Her`);
  await db.setConversation(ownerId, sid);
  await tw.sayInRoom(sid, copy.groupOpened(owner.handle));
  return { owner, sid };
}

export async function apply(effects) {
  for (const e of effects) {
    switch (e.type) {
      case 'create_user':
        await db.createUser(e.phone, e.joinCode);
        break;

      case 'set_handle':
        await db.setHandle(e.userId, e.handle);
        break;

      case 'set_state':
        await db.setState(e.userId, e.state);
        break;

      case 'create_invite':
        await db.createInvite(e.ownerId, e.phone);
        break;

      case 'activate_invite':
        await db.activateInvite(e.ownerId, e.phone);
        break;

      case 'decline_invite':
        await db.declineInvite(e.ownerId, e.phone);
        break;

      case 'add_to_room': {
        const { owner, sid } = await room(e.ownerId);
        await tw.addToRoom(sid, e.phone);
        // The one derived decision that lives here: a creator with nobody in
        // their circle cannot post, so the first YES is what makes them ready.
        if (owner.state === S.BUILDING_CIRCLE) {
          await db.setState(e.ownerId, S.READY);
        }
        break;
      }

      case 'create_entry':
        await db.createEntry(e.userId, e.raw, e.clean);
        break;

      case 'set_entry_mode':
        await db.setEntryMode(e.entryId, e.mode, e.postAt, e.chaseAt);
        break;

      case 'set_outcome':
        await db.setOutcome(e.entryId, e.outcome);
        break;

      case 'post_entry': {
        const { sid } = await room(e.ownerId);
        await tw.sayInRoom(sid, e.body);
        await db.markPosted(e.entryId);
        break;
      }

      case 'group': {
        const { sid } = await room(e.ownerId);
        await tw.sayInRoom(sid, e.body);
        break;
      }

      case 'mark_chased':
        await db.markChased(e.entryId);
        break;

      case 'mark_outcome_asked':
        await db.markOutcomeAsked(e.entryId);
        break;

      case 'stop': {
        const u = await db.findUserByPhone(e.phone);
        if (u?.conversation_sid) await tw.removeFromRoom(u.conversation_sid, e.phone);
        // Also drop them out of any circle they had joined as a buddy.
        for (const c of await db.sql`select owner_id from circle
                                     where phone = ${e.phone} and status = 'active'`) {
          const owner = await db.findUserById(c.owner_id);
          if (owner?.conversation_sid) {
            await tw.removeFromRoom(owner.conversation_sid, e.phone);
          }
        }
        await db.stop(e.phone);
        break;
      }

      case 'restart':
        await db.restart(e.phone);
        break;

      default:
        throw new Error(`unknown effect: ${e.type}`);
    }
  }
}

export async function deliver(replies) {
  for (const r of replies) {
    await tw.send(r.to, r.body);
    await db.logMessage('out', r.to, r.body);
  }
}
