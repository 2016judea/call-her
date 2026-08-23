// Daily. Idempotent — every action is gated on its own marker column, so a
// double invocation cannot post or chase twice.

import { createEngine } from '../lib/engine.js';
import { scrub } from '../lib/scrub.js';
import * as db from '../lib/db.js';
import * as channel from '../lib/twilio.js';

const engine = createEngine({ db, channel, scrub });

export default async function handler(req, res) {
  if (req.headers.authorization?.replace('Bearer ', '') !== process.env.CRON_SECRET) {
    return res.status(401).end();
  }
  const done = await engine.tick();
  if (done.errors.length) console.error('cron', done.errors);
  return res.status(200).json(done);
}
