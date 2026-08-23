// Point the bot at production. Run after `bin/local.js --take-over`, or when
// the deployment URL changes.
//
//   node bin/webhook.js                     -> https://call-her.vercel.app
//   node bin/webhook.js https://other.app   -> somewhere else
//   node bin/webhook.js --show              -> what is currently set

import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const api = (m) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${m}`;

if (process.argv.includes('--show')) {
  const { result } = await fetch(api('getWebhookInfo')).then((r) => r.json());
  console.log(result.url || '(no webhook — the bot is only reachable by polling)');
  if (result.last_error_message) {
    console.log(`last error: ${result.last_error_message} (${result.last_error_date})`);
  }
  process.exit(0);
}

const base = process.argv.find((a) => a.startsWith('https://')) ?? 'https://call-her.vercel.app';
if (!process.env.TELEGRAM_SECRET) {
  console.error('TELEGRAM_SECRET is not set locally. It must match the deployment’s.');
  process.exit(1);
}
const res = await fetch(api('setWebhook'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `${base}/api/telegram`,
    secret_token: process.env.TELEGRAM_SECRET,
    allowed_updates: ['message', 'my_chat_member'],
  }),
}).then((r) => r.json());
console.log(res.ok ? `webhook -> ${base}/api/telegram` : `failed: ${res.description}`);
