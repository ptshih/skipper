// @skipper/api — transactional email. Exactly ONE message exists: the password reset.
//
// Why it's not optional: email/password is the ONLY way into an account (social providers register
// only when their creds are present, and GOOGLE_/APPLE_CLIENT_ID are unset in prod — see ./auth), and
// there is no email verification. Without a reset path, a forgotten password or a typo'd address is
// PERMANENT account loss, taking the rider's drives and their credit ledger with it — and the ledger
// never refunds. That's a support burden with no support channel.
//
// Raw `fetch` to Resend's REST API, no SDK — the same call the studio's TTS makes to Google
// (packages/studio/src/pipeline/tts.ts): a single HTTP POST doesn't earn a dependency.
//
// ⚠ SETUP: RESEND_API_KEY must be set AND the EMAIL_FROM domain verified with Resend (DNS records on
// skipper.fm). Unset = every reset request throws, and Better Auth's enumeration-safe response means
// the rider is told "check your email" for a message that will never arrive. `emailConfigured()` lets
// boot log that loudly rather than discover it from a stranded user.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Sender identity. Must be a Resend-VERIFIED domain or the API rejects the send. */
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Skipper <skipper@skipper.fm>'

/** Whether transactional email can actually be sent. Callers log; they don't silently degrade. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

async function sendEmail(opts: { to: string; subject: string; text: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Loud, not silent: a missing key is a DEPLOY error. Throwing surfaces a 500 to the caller
    // instead of letting Better Auth's "we sent it if it exists" reply become a lie.
    throw new Error('RESEND_API_KEY is not set — cannot send transactional email')
  }
  // Bound the upstream: this sits on the rider's request path, and a hung mail API must not pin a
  // Cloud Run slot (the same reasoning as the Routes timeout in packages/routing).
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [opts.to], subject: opts.subject, text: opts.text }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    // Never echo the body to the rider — it can carry the address back. Log for the operator.
    const detail = await res.text().catch(() => '')
    console.error(`[api] email send failed (${res.status}): ${detail.slice(0, 300)}`)
    throw new Error(`email send failed: ${res.status}`)
  }
}

/** The reset message. Plain text on purpose — it renders everywhere, can't break into a busted
 *  image, and reads like a person wrote it. `url` is Better Auth's one-time link. */
export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'Reset your Skipper password',
    text: [
      'Someone asked to reset the password on this Skipper account.',
      '',
      'Open this link to set a new one:',
      url,
      '',
      'The link works once and expires in an hour.',
      "If this wasn't you, ignore this email — nothing changes until the link is used.",
      '',
      '— The Skipper',
    ].join('\n'),
  })
}
