// The guard that runs before anything reaches a group text.
//
// Two jobs, one call: take out anyone's name (she did not sign up for this),
// and flag explicit content (US carriers block SHAFT content, and a single
// flag takes the number down for every user at once).
//
// See docs/COMPLIANCE.md for why this is a hard gate and not a filter.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

const Result = z.object({
  clean: z.string().describe(
    'The entry with every personal name of another person replaced by a short ' +
    'descriptive handle in the same register the writer used (e.g. "the ' +
    'architect", "the girl from the run club"). Change nothing else — keep ' +
    'their wording, punctuation and typos exactly as written.'),
  removed_names: z.array(z.string()).describe(
    'Each name of another person that was replaced. Empty if none.'),
  explicit: z.boolean().describe(
    'True only if the entry contains sexually explicit or graphic content that ' +
    'a US mobile carrier would block under CTIA SHAFT rules. Frank talk about ' +
    'attraction, chemistry or kissing is not explicit. Graphic description of ' +
    'sex acts is.'),
});

const SYSTEM = `You prepare first-date journal entries for a private group text \
between a person and a handful of their close friends.

Two jobs, and nothing else:

1. Replace every personal name of ANOTHER person with a short descriptive \
handle that reads naturally in the writer's own voice. The person being written \
about did not consent to being discussed, so her name must never leave this \
step. Place names, bars, restaurants and neighbourhoods are NOT personal names \
— leave them exactly as written; they are what makes the entry worth reading.
2. Judge whether a US mobile carrier would block the message as sexually \
explicit under CTIA SHAFT rules.

Do not improve, shorten, summarise, correct or clean up their writing. Do not \
add anything. The entry is theirs.`;

const client = new Anthropic();

/**
 * @param {string} body raw entry as typed
 * @returns {Promise<{clean:string, removedNames:string[], explicit:boolean}>}
 * @throws if the guard cannot run — callers MUST fail closed and post nothing.
 */
export async function scrub(body) {
  // Structured output lives on the beta messages resource in @anthropic-ai/sdk
  // 0.71.x — `output_format` + `client.beta.messages.parse`, verified against
  // the installed types rather than recalled. `thinking` is deliberately
  // omitted: it is adaptive by default on claude-opus-5, and this SDK version
  // does not yet type the adaptive shape.
  const res = await client.beta.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low' },
    output_format: betaZodOutputFormat(Result),
    messages: [{ role: 'user', content: body }],
  });

  if (res.stop_reason === 'refusal') {
    // The model declined to process it at all. Treat exactly like explicit:
    // refuse, don't guess.
    return { clean: '', removedNames: [], explicit: true };
  }
  const out = res.parsed_output;
  if (!out) throw new Error('scrub: no parsed output');

  return {
    clean: out.clean.trim(),
    removedNames: out.removed_names ?? [],
    explicit: out.explicit === true,
  };
}
