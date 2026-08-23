// Twilio inbound webhook. A shim over lib/engine.js — no logic of its own.

import { createEngine } from '../lib/engine.js';
import { normalize } from '../lib/phone.js';
import { scrub } from '../lib/scrub.js';
import * as db from '../lib/db.js';
import * as channel from '../lib/twilio.js';

const engine = createEngine({ db, channel, scrub });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const url = `https://${req.headers.host}${req.url}`;
  if (!channel.verify(req, url)) return res.status(403).send('bad signature');

  const from = normalize(req.body?.From);
  const body = req.body?.Body ?? '';

  if (from) {
    try {
      await engine.inbound(from, body);
    } catch (err) {
      console.error('sms', from, err);
      // Fail closed, and say so. Silence reads as "it went through".
      await channel.send(from,
        `Something broke on my end — nothing was sent to anyone. Try again in a minute.`
      ).catch(() => {});
    }
  }

  // Replies go out over the REST API, not TwiML: one inbound message can
  // produce messages to more than one person.
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send('<Response/>');
}
