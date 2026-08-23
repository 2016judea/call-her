// The landing page's only job: take a number and start the text conversation.
// No account, no password, nothing to log into.

import { normalize } from '../lib/phone.js';
import * as db from '../lib/db.js';
import * as tw from '../lib/twilio.js';
import { makeJoinCode } from '../lib/keywords.js';
import { copy } from '../lib/copy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const phone = normalize(req.body?.phone);
  if (!phone) {
    return res.status(400).json({ error: 'That does not look like a US mobile number.' });
  }

  const existing = await db.findUserByPhone(phone);
  if (existing && !existing.stopped_at) {
    // Already going. Nudge rather than restart them.
    await tw.send(phone, `You're already set up here. Text me after your next first date.`);
    return res.status(200).json({ ok: true, returning: true });
  }

  await db.createUser(phone, makeJoinCode());
  await db.restart(phone);
  await tw.send(phone, copy.welcome());
  await db.logMessage('out', phone, copy.welcome());

  return res.status(200).json({ ok: true });
}
