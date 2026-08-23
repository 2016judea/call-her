// Telegram webhook. A shim over lib/telegram-flow.js.

import { createEngine } from '../lib/engine.js';
import { createTelegramFlow } from '../lib/telegram-flow.js';
import { scrub } from '../lib/scrub.js';
import * as db from '../lib/db.js';
import * as channel from '../lib/telegram.js';

const engine = createEngine({ db, channel, scrub });
const flow = createTelegramFlow({ db, channel, engine });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_SECRET) {
    return res.status(403).end();
  }
  try {
    await flow.route(req.body ?? {});
  } catch (err) {
    console.error('telegram', err);
  }
  // Always 200. Telegram retries non-2xx, and a replayed update would re-run
  // effects that are not idempotent at this layer.
  return res.status(200).json({ ok: true });
}
