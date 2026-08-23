// Inbound text classification. Pure, and deliberately forgiving —
// a user who types "wait." or "Yes!" must not fall through to
// "we posted your entry".

const STOP  = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'stop all'];
const START = ['start', 'unstop', 'yes join', 'resume'];
const HELP  = ['help', 'info'];

/** Strip punctuation/whitespace and lowercase, for keyword matching only. */
export function canon(body) {
  return String(body ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!,;:?"'’]+$/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Classify an inbound message.
 * Compliance keywords are checked first and can never be shadowed by
 * application state — a user replying STOP while we're waiting for
 * NOW/WAIT is opting out, not naming a mode.
 */
export function classify(body) {
  const c = canon(body);
  if (!c) return { kind: 'empty' };

  if (STOP.includes(c))  return { kind: 'stop' };
  if (START.includes(c)) return { kind: 'start' };
  if (HELP.includes(c))  return { kind: 'help' };

  const join = /^join\s+([a-z0-9]{4})$/.exec(c);
  if (join) return { kind: 'join', code: join[1] };

  if (c === 'yes' || c === 'y' || c === 'ok' || c === 'okay') return { kind: 'yes' };
  if (c === 'no'  || c === 'n' || c === 'pass')               return { kind: 'no' };

  if (c === 'now'  || c === 'open' || c === 'post')  return { kind: 'now' };
  if (c === 'wait' || c === 'hold' || c === 'later') return { kind: 'wait' };

  if (c === 'ready' || c === 'done') return { kind: 'ready' };

  return { kind: 'text', body: String(body).trim() };
}

/** A 4-char join code. Avoids 0/o/1/l/i so it survives being read aloud. */
export function makeJoinCode(random = Math.random) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return out;
}
