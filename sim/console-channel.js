// The channel contract, printed to a terminal instead of sent to a phone.
// Records everything so tests can assert on what a given person actually saw.

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  us:  (s) => `\x1b[38;5;209m${s}\x1b[0m`,
  them:(s) => `\x1b[38;5;252m${s}\x1b[0m`,
  room:(s) => `\x1b[38;5;114m${s}\x1b[0m`,
};

export function consoleChannel({ number = '+16125550100', quiet = false } = {}) {
  const rooms = new Map();     // sid -> {name, members: Set}
  const sent = [];             // {to, body}
  const said = [];             // {sid, body}
  let n = 0;

  const out = (s) => { if (!quiet) console.log(s); };
  const wrap = (body, pad) =>
    body.split('\n').map((l, i) => (i ? pad + l : l)).join('\n');

  return {
    ourNumber: number,
    canInviteByCode: true,
    inviteHow: (code) =>
      `Send them this:\n"Text  join ${code}  to ${number}"\n\nUp to 8.`,
    _sent: sent, _said: said, _rooms: rooms,

    async send(to, body) {
      sent.push({ to, body });
      out(`  ${C.us('Call Her')} ${C.dim('→ ' + to)}\n    ${wrap(body, '    ')}\n`);
    },

    async createRoom(ownerPhone, name) {
      const sid = `CHsim${String(++n).padStart(3, '0')}`;
      rooms.set(sid, { name, members: new Set([ownerPhone]) });
      out(`  ${C.dim(`[room ${sid} opened — ${name}]`)}`);
      return sid;
    },

    async addToRoom(sid, phone) {
      rooms.get(sid)?.members.add(phone);
      out(`  ${C.dim(`[${phone} joined ${sid} — ${rooms.get(sid).members.size} in the room]`)}`);
    },

    async removeFromRoom(sid, phone) {
      rooms.get(sid)?.members.delete(phone);
      out(`  ${C.dim(`[${phone} left ${sid}]`)}`);
    },

    async sayInRoom(sid, body) {
      said.push({ sid, body });
      const who = [...(rooms.get(sid)?.members ?? [])].length;
      out(`  ${C.room(`GROUP ${sid}`)} ${C.dim(`(${who} people)`)}\n    ${wrap(body, '    ')}\n`);
    },

    /** Print an inbound line the way a phone would show it. */
    echoIn(from, body) {
      out(`  ${C.them(from)} ${C.dim('→ Call Her')}\n    ${wrap(body, '    ')}\n`);
    },
  };
}
