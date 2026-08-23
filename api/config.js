// The page needs to show the number. Env stays the single source of truth.
export default function handler(req, res) {
  const n = process.env.TWILIO_NUMBER ?? '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n);
  res.setHeader('Cache-Control', 's-maxage=3600');
  return res.status(200).json({
    number: n,
    pretty: m ? `(${m[1]}) ${m[2]}-${m[3]}` : n,
  });
}
