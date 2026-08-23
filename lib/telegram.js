// Telegram channel adapter. Same contract as lib/twilio.js.
//
// This exists because the SMS path depends on carrier campaign approval that
// can be refused outright and cannot be resubmitted (docs/COMPLIANCE.md). The
// machine is pure and the engine takes its channel as an argument, so the
// fallback costs one file.
//
// Two Bot API facts drive the differences from SMS:
//   - A bot cannot create a group or add anyone to one. The creator makes the
//     group and adds the bot. Which suits this product: the group chat they
//     already have with those two friends IS the circle.
//   - In a group, privacy mode means the bot only receives commands addressed
//     to it and replies to it — not general chatter. We only need `/claim`.
//
// The upshot: consent is implicit on this channel. Everyone in that room chose
// to be in it and can leave it themselves, so there is no invite handshake.

const API = (method) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

async function call(method, body) {
  const res = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
  return json.result;
}

/** Our identity in copy. Telegram has no number to show. */
export const ourNumber = process.env.TELEGRAM_BOT_HANDLE ?? '@CallHerBot';

/** `tg:<id>` is how a Telegram identity is stored in the phone column. */
export const asId = (telegramUserId) => `tg:${telegramUserId}`;
export const toChatId = (id) => Number(String(id).replace(/^tg:/, ''));

export async function send(to, body) {
  return call('sendMessage', { chat_id: toChatId(to), text: body });
}

export async function sayInRoom(chatId, body) {
  return call('sendMessage', { chat_id: Number(chatId), text: body });
}

/**
 * Not possible on this channel, by design of the Bot API. A creator is never
 * READY here until they have bound a group with /claim, so nothing should ever
 * reach this — and if it does, the loud failure is correct.
 */
export async function createRoom() {
  throw new Error(
    'telegram: a bot cannot create a group. The creator adds the bot to theirs ' +
    'and sends /claim — see api/telegram.js.');
}

/** No-op: membership is the group's own business on this channel. */
export async function addToRoom() { /* the room's members manage themselves */ }

/** A bot may only remove a member if it is an admin; leaving is theirs to do. */
export async function removeFromRoom(chatId, id) {
  try {
    await call('banChatMember', { chat_id: Number(chatId), user_id: toChatId(id) });
    await call('unbanChatMember', {
      chat_id: Number(chatId), user_id: toChatId(id), only_if_banned: true });
  } catch {
    // Not an admin, or they already left. Either way their STOP is honoured in
    // our own records, which is what governs what we send.
  }
}

/**
 * A bot cannot add anyone to a group, so there is nothing a join code could do
 * here. Friends arrive by already being in the group the bot is added to.
 */
export const canInviteByCode = false;

export const inviteHow = () =>
  `Don't make a new group — add me to the one you already have with them:\n\n` +
  `open that chat  ->  add member  ->  ${ourNumber}\n\n` +
  `then send  /claim  in it.`;

export async function setWebhook(url, secret) {
  return call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'my_chat_member'],
  });
}
