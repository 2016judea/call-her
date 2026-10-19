// The two inbound doors. Each must refuse when its secret is unset — a missing
// env var and a missing header are both `undefined`, and `!==` between them is
// false — and the cron must not accept a header any client can type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import cron from '../api/cron.js';
import telegram from '../api/telegram.js';

function res() {
  const r = { code: null, body: undefined };
  r.status = (c) => { r.code = c; return r; };
  r.end = () => r;
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

test('cron: no CRON_SECRET in the environment refuses every caller', async () => {
  delete process.env.CRON_SECRET;
  const r = res();
  await cron({ method: 'GET', headers: {} }, r);
  assert.equal(r.code, 401);
});

test('cron: x-vercel-cron is not a credential', async () => {
  process.env.CRON_SECRET = 'a-real-secret';
  const r = res();
  await cron({ method: 'GET', headers: { 'x-vercel-cron': '1' } }, r);
  assert.equal(r.code, 401);
});

test('cron: the wrong bearer is refused', async () => {
  process.env.CRON_SECRET = 'a-real-secret';
  const r = res();
  await cron({ method: 'GET', headers: { authorization: 'Bearer nope' } }, r);
  assert.equal(r.code, 401);
});

test('telegram: no TELEGRAM_SECRET in the environment refuses every POST', async () => {
  delete process.env.TELEGRAM_SECRET;
  const r = res();
  await telegram({ method: 'POST', headers: {}, body: {} }, r);
  assert.equal(r.code, 403);
});

test('telegram: the wrong secret token is refused', async () => {
  process.env.TELEGRAM_SECRET = 'tg-secret';
  const r = res();
  await telegram({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'nope' }, body: {} }, r);
  assert.equal(r.code, 403);
});
