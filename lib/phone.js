// Phone normalisation. Everything in the system stores E.164.

/** Normalise a US/CA number to E.164, or null if it can't be one. */
export function normalize(input) {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[^\d+]/g, '');
  const bare = digits.startsWith('+') ? digits.slice(1) : digits;
  if (!/^\d+$/.test(bare)) return null;
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  // Anything else is out of scope: group MMS is +1 only.
  return null;
}

/** For copy: +16125550123 -> (612) 555-0123 */
export function pretty(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
