// Postgres access. Queries only — no decisions live here.

import { neon } from '@neondatabase/serverless';
import { S } from './machine.js';

const sql = neon(process.env.DATABASE_URL);
export { sql };

const one = (rows) => rows[0] ?? null;

export const findUserByPhone = async (phone) =>
  one(await sql`select * from users where phone = ${phone}`);

export const findUserByCode = async (code) =>
  one(await sql`select * from users where join_code = ${code}
                and stopped_at is null`);

export const findUserById = async (id) =>
  one(await sql`select * from users where id = ${id}`);

export const createUser = async (phone, joinCode) =>
  one(await sql`insert into users (phone, join_code, state)
                values (${phone}, ${joinCode}, ${S.AWAITING_HANDLE})
                on conflict (phone) do update set phone = excluded.phone
                returning *`);

export const setHandle = (id, handle) =>
  sql`update users set handle = ${handle} where id = ${id}`;

export const setState = (id, state) =>
  sql`update users set state = ${state} where id = ${id}`;

export const setConversation = (id, sid) =>
  sql`update users set conversation_sid = ${sid} where id = ${id}`;

/** A pending invite addressed to this number, if any. Newest wins. */
export const findPendingInvite = async (phone) =>
  one(await sql`select * from circle where phone = ${phone} and status = 'pending'
                order by invited_at desc limit 1`);

export const activeCircle = async (ownerId) =>
  await sql`select * from circle where owner_id = ${ownerId} and status = 'active'
            order by joined_at`;

export const countActiveCircle = async (ownerId) => {
  const r = one(await sql`select count(*)::int as n from circle
                          where owner_id = ${ownerId} and status = 'active'`);
  return r?.n ?? 0;
};

export const createInvite = (ownerId, phone) =>
  sql`insert into circle (owner_id, phone, status) values (${ownerId}, ${phone}, 'pending')
      on conflict (owner_id, phone) do update set status = 'pending',
        invited_at = now()`;

export const activateInvite = (ownerId, phone) =>
  sql`update circle set status = 'active', joined_at = now()
      where owner_id = ${ownerId} and phone = ${phone}`;

export const declineInvite = (ownerId, phone) =>
  sql`update circle set status = 'removed' where owner_id = ${ownerId}
      and phone = ${phone}`;

export const createEntry = async (userId, raw, clean) =>
  one(await sql`insert into entries (author_id, raw_body, body)
                values (${userId}, ${raw}, ${clean}) returning *`);

/** The entry a user is mid-conversation about: newest with no mode, or held. */
export const openEntry = async (userId) =>
  one(await sql`select * from entries where author_id = ${userId}
                and (mode is null or (mode = 'wait' and posted_at is null))
                order by created_at desc limit 1`);

export const setEntryMode = (id, mode, postAt, chaseAt) =>
  sql`update entries set mode = ${mode}, post_at = ${postAt}, chase_at = ${chaseAt}
      where id = ${id}`;

export const setOutcome = (id, outcome) =>
  sql`update entries set outcome = ${outcome} where id = ${id}`;

export const markPosted = (id) =>
  sql`update entries set posted_at = now() where id = ${id}`;

export const markChased = (id) =>
  sql`update entries set chased_at = now() where id = ${id}`;

export const markOutcomeAsked = (id) =>
  sql`update entries set outcome_asked_at = now() where id = ${id}`;

/**
 * Held entries whose week is up. `for update skip locked` so two overlapping
 * cron invocations can never post the same entry twice.
 */
export const duePosts = async (now) =>
  await sql`select * from entries where posted_at is null and post_at is not null
            and post_at <= ${now} and mode = 'wait' order by post_at limit 100`;

export const dueChases = async (now) =>
  await sql`select * from entries where chased_at is null and chase_at is not null
            and chase_at <= ${now} and posted_at is not null
            order by chase_at limit 100`;

export const stop = async (phone) => {
  await sql`update users set stopped_at = now(), state = ${S.STOPPED}
            where phone = ${phone}`;
  await sql`update circle set status = 'removed' where phone = ${phone}`;
};

export const restart = (phone) =>
  sql`update users set stopped_at = null, state = ${S.AWAITING_HANDLE}
      where phone = ${phone}`;

export const logMessage = (direction, peer, body, userId = null) =>
  sql`insert into messages (direction, peer, body, user_id)
      values (${direction}, ${peer}, ${body}, ${userId})`;
