// Performs the effects the machine decided on.
//
// Takes its adapters as arguments rather than importing them. That is what
// lets the simulator drive this exact code with an in-memory store, and what
// makes a second channel (Telegram) a new argument instead of a new fork.

import { copy } from './copy.js';
import { S } from './machine.js';

/**
 * @param {object} io
 *   db      — the query surface (see lib/db.js for the contract)
 *   channel — send / createRoom / addToRoom / removeFromRoom / sayInRoom
 */
export function createEffects({ db, channel }) {
  /** Ensure a creator has a room, creating it (with them in it) on first need. */
  async function room(ownerId) {
    const owner = await db.findUserById(ownerId);
    if (owner.conversation_sid) return { owner, sid: owner.conversation_sid, fresh: false };
    const sid = await channel.createRoom(
      owner.phone, `${owner.handle ?? owner.phone} — Call Her`);
    await db.setConversation(ownerId, sid);
    // Deliberately does NOT greet the room here. At this instant the only
    // member is the creator, so an intro addressed to the circle would be read
    // by nobody it was written for. The caller greets once someone has joined.
    return { owner, sid, fresh: true };
  }

  async function apply(effects) {
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
          const { owner, sid, fresh } = await room(e.ownerId);
          await channel.addToRoom(sid, e.phone);
          if (fresh) await channel.sayInRoom(sid, copy.groupOpened(owner.handle));
          // The one derived decision that lives here: a creator with nobody in
          // their circle cannot post, so the first YES is what makes them ready.
          if (owner.state === S.BUILDING_CIRCLE) {
            await db.setState(e.ownerId, S.READY);
          }
          break;
        }

        case 'create_entry':
          await db.createEntry(e.userId, e.raw, e.clean, e.postAt, e.chaseAt);
          break;

        case 'set_entry_mode':
          await db.setEntryMode(e.entryId, e.mode);
          break;

        case 'set_outcome':
          await db.setOutcome(e.entryId, e.outcome);
          break;

        case 'post_entry': {
          const { sid } = await room(e.ownerId);
          await channel.sayInRoom(sid, e.body);
          await db.markPosted(e.entryId);
          break;
        }

        case 'group': {
          const { sid } = await room(e.ownerId);
          await channel.sayInRoom(sid, e.body);
          break;
        }

        case 'mark_chased':
          await db.markChased(e.entryId);
          break;

        case 'mark_outcome_asked':
          await db.markOutcomeAsked(e.entryId);
          break;

        case 'stop': {
          // Drop them from their own room and from every circle they joined.
          const u = await db.findUserByPhone(e.phone);
          if (u?.conversation_sid) {
            await channel.removeFromRoom(u.conversation_sid, e.phone);
          }
          for (const ownerId of await db.circleMembershipsOf(e.phone)) {
            const owner = await db.findUserById(ownerId);
            if (owner?.conversation_sid) {
              await channel.removeFromRoom(owner.conversation_sid, e.phone);
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

  async function deliver(replies) {
    for (const r of replies) {
      await channel.send(r.to, r.body);
      await db.logMessage('out', r.to, r.body);
    }
  }

  return { apply, deliver };
}
