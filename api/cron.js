// Daily pass: held entries come due, day-7 questions fire.
//
// Idempotent at the record level — every action is gated on its own marker
// column — and atomic at the store level, so two overlapping runs cannot both
// post the same entry.

import { blobStore } from '../lib/blob-db.js';
import { createEngine } from '../lib/engine.js';
import { scrub } from '../lib/scrub.js';
import * as telegram from '../lib/telegram.js';

const store = blobStore();

export default async function handler(req, res) {
  const bearer = req.headers.authorization?.replace('Bearer ', '');
  // Vercel Cron signs its own requests; a manual call needs the secret.
  const fromVercel = req.headers['x-vercel-cron'] === '1';
  if (!fromVercel && bearer !== process.env.CRON_SECRET) return res.status(401).end();

  const done = await store.transaction(async (db, channel) => {
    const engine = createEngine({ db, channel, scrub });
    return engine.tick();
  }, telegram);

  if (done.errors?.length) console.error('cron', done.errors);
  return res.status(200).json(done);
}
