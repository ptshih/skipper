// @skipper/api — transactional email. TWO messages exist: the sign-in CODE and the password reset.
//
// ⚠ THIS FILE IS NOW ON THE SIGN-IN PATH, NOT ONLY THE RECOVERY PATH, and that is a change in kind.
// Since 2026-08-05 email OTP is the DEFAULT way in (docs/designs/lowest-friction-signup.md §8), so a
// mail that does not arrive is no longer "this rider cannot RECOVER their account" — it is "this
// rider cannot GET IN AT ALL, and neither can a brand-new one". Deliverability is now load-bearing
// for the front door: if these stop landing, signup and sign-in stop, together, silently.
//   • That is exactly why §8.6's "set a password" control in Settings exists — a rider who has set
//     one has a way in that does not depend on mail arriving. It is the hedge for this paragraph.
//   • The password RESET below stays for the same reason it always existed: a password that exists
//     still needs a recovery route.
//
// Raw `fetch` to Resend's REST API, no SDK — the same call the studio's TTS makes to Google
// (packages/studio/src/pipeline/tts.ts): a single HTTP POST doesn't earn a dependency.
//
// ⚠ SETUP: RESEND_API_KEY must be set AND the EMAIL_FROM domain verified with Resend (DNS records on
// skipper.fm). Unset = every reset request throws, and Better Auth's enumeration-safe response means
// the rider is told "check your email" for a message that will never arrive. `emailConfigured()` lets
// boot log that loudly rather than discover it from a stranded user.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Sender identity. Must be a Resend-VERIFIED domain or the API rejects the send.
 *
 *  A SENDING SUBDOMAIN, not the apex — Resend's own guidance ("send from a subdomain … to isolate
 *  your sending reputation"), and it matters more than usual here because Skipper shares a Resend
 *  account with Manoa Health: a consumer app's bounce/spam reputation must not be able to reach a
 *  health product's mail, and `skipper.fm`'s apex already serves Firebase Hosting. `notifications.`
 *  (not `mail.`) because `mail.<domain>` is the conventional webmail/MX label and would collide with
 *  a future Workspace; and NOT `send.` — Resend puts its own SPF records at `send.<your-domain>`
 *  (verified against the live account), so `send.skipper.fm` would yield `send.send.skipper.fm`. */
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'Skipper <skipper@notifications.skipper.fm>'

/** Where a rider's REPLY goes. Not cosmetic: `EMAIL_FROM` lives on the sending subdomain, whose
 *  only MX is Resend/SES's bounce-and-complaint endpoint — a mailbox nobody reads, because it isn't
 *  one. Without this header, a reply to a reset mail is accepted and then discarded. The most common
 *  reply to a password-reset email is "I didn't request this", which is a SECURITY SIGNAL (someone is
 *  probing an account) and the one message we can least afford to drop on the floor.
 *
 *  ⚠ `reply_to`, snake_case — Resend's REST API. Their SDK takes `replyTo`, and we deliberately don't
 *  use the SDK (see the note above the endpoint), so the camelCase spelling would be silently ignored
 *  rather than rejected. Verified against Resend's API reference, 2026-07-27.
 *
 *  ⚠ EXPORTED, because this is not only the reply-to header — it is THE published support address, and
 *  ./drives serves it to a rider as the one route past the free-drive wall. That was a second
 *  `process.env.EMAIL_REPLY_TO ?? 'hello@skipper.fm'` until 2026-08-04, i.e. two independent chances
 *  to point a rider at an address this mailer does not accept replies for. `hello@skipper.fm` is the
 *  founder rule for every PUBLISHED address (same inbox as the legal pages and the in-app report
 *  link), never a personal one — and it must be READ by a human, since both readers are a rider
 *  expecting an answer. */
export const SUPPORT_EMAIL = process.env.EMAIL_REPLY_TO ?? 'hello@skipper.fm'

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
    body: JSON.stringify({
      from: EMAIL_FROM,
      reply_to: SUPPORT_EMAIL,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    // Never echo the body to the rider — it can carry the address back. Log for the operator.
    const detail = await res.text().catch(() => '')
    console.error(`[api] email send failed (${res.status}): ${detail.slice(0, 300)}`)
    throw new Error(`email send failed: ${res.status}`)
  }
}

/** The sign-in code — the DEFAULT way into Skipper, so this is the most important mail we send.
 *
 *  ⚠ ONE MESSAGE FOR BOTH SIGNING IN AND SIGNING UP, deliberately, because on the wire they are the
 *  same call: `signIn.emailOtp` creates the account when the address is new and signs the rider in
 *  when it isn't (better-auth 1.6.23 `plugins/email-otp/routes.mjs`). Copy that said "welcome back"
 *  would be wrong half the time and copy that said "confirm your new account" the other half, so it
 *  says neither. ⚠ It also must not confirm WHICH case this is — the send route answers identically
 *  for a known and an unknown address, and wording that leaked the difference would turn every
 *  inbox into an oracle for who has a Skipper account.
 *
 *  ⚠ The code goes in the SUBJECT as well as the body. iOS surfaces it on the lock screen and offers
 *  one-tap autofill from the notification, which is most of the friction win this whole change is
 *  for — a rider who never opens the mail app is the point. */
export async function sendSignInCodeEmail(to: string, otp: string): Promise<void> {
  await sendEmail({
    to,
    subject: `${otp} is your Skipper code`,
    text: [
      'Here is your code for getting on the road:',
      '',
      otp,
      '',
      'It works once and runs out in five minutes.',
      "If you didn't ask for it, ignore this email — nobody gets in without the code.",
      '',
      'The Skipper',
    ].join('\n'),
  })
}

/** The reset message. Plain text on purpose — it renders everywhere, can't break into a busted
 *  image, and reads like a person wrote it. `url` is Better Auth's one-time link.
 *  ⚠ Still reachable, and still needed: password is no longer how anyone SIGNS UP, but a rider who
 *  set one in Settings (§8.6) can still forget it. */
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
      "If this wasn't you, ignore this email. Nothing changes until the link is used.",
      '',
      'The Skipper',
    ].join('\n'),
  })
}
