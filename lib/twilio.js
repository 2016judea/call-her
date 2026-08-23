// Twilio adapter: one number, one standing group conversation per creator.
//
// Group texting runs on Conversations over group MMS. Constraints that shaped
// this file, from Twilio's docs:
//   - +1 long codes only. Toll-free and short codes cannot do group texts.
//   - 10 participants maximum, and our own number is one of them.
//   - Group-MMS SMS participants carry an Address and NO ProxyAddress. That is
//     why each creator gets exactly one durable room rather than one per date:
//     the (participant, proxy) uniqueness rule (error 50425) has no documented
//     behaviour for proxy-less group participants, and one room per person
//     never puts it to the test.

import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
export const OUR_NUMBER = process.env.TWILIO_NUMBER;
/** Channel contract: every adapter exposes its own identity as `ourNumber`. */
export const ourNumber = process.env.TWILIO_NUMBER;

const service = () =>
  client.conversations.v1.services(process.env.TWILIO_CONVERSATIONS_SERVICE_SID);

/** Direct 1:1 SMS. Used for everything between us and one person. */
export async function send(to, body) {
  return client.messages.create({ from: OUR_NUMBER, to, body });
}

/** Create the creator's standing room. Their number is the first participant. */
export async function createRoom(creatorPhone, friendlyName) {
  const conv = await service().conversations.create({ friendlyName });
  await service().conversations(conv.sid).participants.create({
    'messagingBinding.address': creatorPhone,
    'messagingBinding.projectedAddress': OUR_NUMBER,
  });
  return conv.sid;
}

/** Add a buddy who has already said YES. */
export async function addToRoom(conversationSid, phone) {
  return service().conversations(conversationSid).participants.create({
    'messagingBinding.address': phone,
    'messagingBinding.projectedAddress': OUR_NUMBER,
  });
}

export async function removeFromRoom(conversationSid, phone) {
  const list = await service().conversations(conversationSid).participants.list();
  const hit = list.find((p) => p.messagingBinding?.address === phone);
  if (hit) await service().conversations(conversationSid).participants(hit.sid).remove();
}

/** Post as Call Her into the group. */
export async function sayInRoom(conversationSid, body) {
  return service().conversations(conversationSid).messages.create({
    author: 'Call Her', body,
  });
}

/** Validate that an inbound webhook actually came from Twilio. */
export function verify(req, url) {
  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN, signature, url, req.body ?? {},
  );
}
