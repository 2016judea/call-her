// Telegram webhook. A shim: authenticate, then run the whole update inside one
// atomic store transaction.

import { blobStore } from '../lib/blob-db.js';
import { createEngine } from '../lib/engine.js';
import { createTelegramFlow } from '../lib/telegram-flow.js';
import { scrub } from '../lib/scrub.js';
import * as telegram from '../lib/telegram.js';

const store = blobStore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_SECRET) {
    return res.status(403).end();
  }

  try {
    await store.transaction(async (db, channel) => {
      const engine = createEngine({ db, channel, scrub });
      const flow = createTelegramFlow({ db, channel, engine });
      return flow.route(req.body ?? {});
    }, telegram);
  } catch (err) {
    console.error('telegram', err);
  }
  // Always 200. Telegram retries non-2xx, and a replayed update would re-run
  // effects that are not idempotent at this layer.
  return res.status(200).json({ ok: true });
}
