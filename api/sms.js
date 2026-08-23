// Twilio inbound webhook. Assembles context, runs the machine, performs effects.

import { machine, S } from '../lib/machine.js';
import { classify } from '../lib/keywords.js';
import { normalize } from '../lib/phone.js';
import { scrub } from '../lib/scrub.js';
import { apply, deliver } from '../lib/effects.js';
import * as db from '../lib/db.js';
import * as tw from '../lib/twilio.js';
import { copy } from '../lib/copy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const url = `https://${req.headers.host}${req.url}`;
  if (!tw.verify(req, url)) return res.status(403).send('bad signature');

  const from = normalize(req.body?.From);
  const body = req.body?.Body ?? '';
  if (!from) return res.status(200).send('<Response/>');

  await db.logMessage('in', from, body);

  try {
    const ctx = await context(from, body);
    const result = machine(ctx, { type: 'sms', from, body });
    await apply(result.effects);
    await deliver(result.replies);
  } catch (err) {
    console.error('sms handler', err);
    // Fail closed and say so. Silence would read as "it went through".
    await tw.send(from, `Something broke on my end — nothing was sent to anyone. Try again in a minute.`)
      .catch(() => {});
  }

  // Replies go out over the REST API above, not TwiML, because one inbound
  // can produce messages to more than one person.
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send('<Response/>');
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
  const openEntry   = user ? await db.openEntry(user.id) : null;

  // The guard only runs on text that is actually about to become an entry.
  // Every other inbound skips the model call entirely — cheaper, faster, and
  // it means STOP never depends on an API being up.
  let scrubbed = null;
  if (user && user.state === S.READY && msg.kind === 'text' && msg.body.length >= 25) {
    scrubbed = await scrub(msg.body);
  }

  return {
    now: new Date(),
    ourNumber: tw.OUR_NUMBER,
    user, invite, inviteOwner, codeOwner, codeOwnerCircleCount,
    activeCircle, openEntry, scrub: scrubbed,
  };
}
