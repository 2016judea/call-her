-- Call Her. Run once against DATABASE_URL.

create table if not exists users (
  id            bigserial primary key,
  phone         text unique not null,          -- E.164
  handle        text,                          -- what the circle sees them as
  join_code     text unique,                   -- 4 chars, what buddies text to join
  state         text not null default 'awaiting_handle',
  conversation_sid text,                       -- their standing group room
  stopped_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists circle (
  id          bigserial primary key,
  owner_id    bigint not null references users(id) on delete cascade,
  phone       text not null,
  name        text,
  status      text not null default 'pending', -- pending | active | removed
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  unique (owner_id, phone)
);

create table if not exists entries (
  id           bigserial primary key,
  author_id    bigint not null references users(id) on delete cascade,
  body         text not null,                  -- scrubbed
  raw_body     text not null,                  -- what they actually typed
  mode         text,                           -- now | wait
  outcome      text,
  created_at   timestamptz not null default now(),
  post_at      timestamptz,                    -- deadline for answering NOW/WAIT
  posted_at    timestamptz,
  chase_at     timestamptz,                    -- when HE is asked for his one update
  chased_at    timestamptz,
  outcome_asked_at timestamptz
);

create table if not exists messages (
  id         bigserial primary key,
  direction  text not null,                    -- in | out
  peer       text not null,
  body       text,
  user_id    bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists entries_due_post  on entries (post_at)  where posted_at is null;
create index if not exists entries_due_chase on entries (chase_at) where chased_at is null;

-- Telegram retries any update it does not get a 200 for; this makes a retry a
-- no-op instead of a second journal entry.
create table if not exists seen_updates (
  id       bigint primary key,
  seen_at  timestamptz not null default now()
);
