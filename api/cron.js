// Daily. Posts held entries whose week is up, and fires the day-7 question
// into the group. Idempotent: every action is gated on its own marker column,
// so a double invocation cannot post or chase twice.

import { machine } from '../lib/machine.js';
import { apply, deliver } from '../lib/effects.js';
import * as db from '../lib/db.js';
import * as tw from '../lib/twilio.js';

export default async function handler(req, res) {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) return res.status(401).end();

  const now = new Date();
  const base = { now, ourNumber: tw.OUR_NUMBER };
  const done = { posts: 0, chases: 0, errors: [] };

  for (const entry of await db.duePosts(now)) {
    try {
      const author = await db.findUserById(entry.author_id);
      if (!author || author.stopped_at) continue;
      const r = machine({ ...base }, { type: 'due_post', entry, author });
      await apply(r.effects);
      await deliver(r.replies);
      done.posts++;
    } catch (err) {
      console.error('due_post', entry.id, err);
      done.errors.push(`post:${entry.id}`);
    }
  }

  for (const entry of await db.dueChases(now)) {
    try {
      const author = await db.findUserById(entry.author_id);
      if (!author || author.stopped_at) continue;
      const r = machine({ ...base }, { type: 'due_chase', entry, author });
      await apply(r.effects);
      await deliver(r.replies);
      done.chases++;
    } catch (err) {
      console.error('due_chase', entry.id, err);
      done.errors.push(`chase:${entry.id}`);
    }
  }

  return res.status(200).json(done);
}
