// Routing for the Telegram channel: the two things specific to it (learning
// the bot was added to a group, and binding that group to a creator), then
// delegation to the same engine the SMS path uses.
//
// Separated from api/telegram.js so it can be driven by tests without HTTP —
// this is the only channel-specific onboarding in the project, which makes it
// the likeliest place for a mistake to hide.

import { S } from './machine.js';

const isGroup = (t) => t === 'group' || t === 'supergroup';

export function createTelegramFlow({ db, channel, engine }) {
  const bot = channel.ourNumber;

  const copy = {
    claimed: (handle) =>
      `Bound. This is where I'll post ${handle}'s entries.\n\n` +
      `Nothing for the rest of you to do — reply here like any group chat.`,
    needsGroup: () =>
      `Now the circle. Don't make a new group — add me to the one you already ` +
      `have with them:\n\nopen that group → add member → ${bot} → then send  ` +
      `/claim  in it.`,
    notYours: () =>
      `Whoever set this up needs to send /claim, not me. Have them do it here.`,
    claimFirstDm: () =>
      `Whoever wants this needs to message me privately first — ${bot}, send ` +
      `/start. Then come back and /claim here.`,
    alreadySet: () => `You're set up. Text me after your next first date.`,
    bound: () => `Bound to that group. Text me after your next first date.`,
  };

  async function route(update) {
    if (update.my_chat_member) {
      const { chat, new_chat_member } = update.my_chat_member;
      // Removed from the group: forget the room rather than posting into a
      // chat we are no longer in.
      if (['left', 'kicked'].includes(new_chat_member.status)) {
        await db.releaseRoom(String(chat.id));
      }
      return { handled: 'membership' };
    }

    const msg = update.message;
    if (!msg?.text) return { handled: 'ignored' };

    const from = channel.asId(msg.from.id);
    const text = msg.text.replace(/@\w+bot\b/gi, '').trim();   // strip @mention

    if (isGroup(msg.chat.type)) {
      // Privacy mode means this is essentially all we ever hear in a group.
      if (/^\/claim$/i.test(text)) return claim(from, msg.chat.id);
      return { handled: 'ignored' };
    }

    if (/^\/start$/i.test(text)) {
      const existing = await db.findUserByPhone(from);
      if (existing && !existing.stopped_at && existing.handle) {
        await channel.send(from, existing.conversation_sid
          ? copy.alreadySet() : copy.needsGroup());
        return { handled: 'start' };
      }
    }

    await engine.inbound(from, text);
    return { handled: 'engine' };
  }

  /** Bind a group to the creator who claimed it, and open their circle. */
  async function claim(from, chatId) {
    const user = await db.findUserByPhone(from);
    if (!user || !user.handle) {
      await channel.sayInRoom(chatId, copy.claimFirstDm());
      return { handled: 'claim-rejected' };
    }
    const owner = await db.findOwnerByRoom(String(chatId));
    if (owner && owner.id !== user.id) {
      await channel.sayInRoom(chatId, copy.notYours());
      return { handled: 'claim-rejected' };
    }
    if (owner && owner.id === user.id) {
      return { handled: 'claim-noop' };   // already theirs; don't re-announce
    }

    await db.setConversation(user.id, String(chatId));
    // Consent is implicit here: everyone in that room chose to be in it and can
    // leave it themselves. So the circle is one marker row meaning "there is a
    // room with people in it" — which is all the machine ever asks.
    const marker = `tgroup:${chatId}`;
    await db.createInvite(user.id, marker);
    await db.activateInvite(user.id, marker);
    if (user.state === S.BUILDING_CIRCLE) await db.setState(user.id, S.READY);

    await channel.sayInRoom(chatId, copy.claimed(user.handle));
    await channel.send(from, copy.bound());
    return { handled: 'claimed' };
  }

  return { route, copy };
}
