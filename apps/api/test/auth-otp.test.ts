/**
 * Pins the VENDOR assumptions that email-OTP sign-in rests on, and the two of OUR choices that are
 * invisible to a typecheck.
 *
 * Since 2026-08-05 an emailed code is the DEFAULT way in — one call signs up and signs in
 * (docs/designs/lowest-friction-signup.md §8). That moved several load-bearing facts out of our code
 * and into better-auth's, where a dependency bump can change them with no error and no failing
 * request. Each `test` below is one of those facts. In the same shape as auth-delete-hook.test.ts
 * (source-text assertions against the INSTALLED package), and for the same reason: exercising any of
 * this for real needs a live database and a real Better Auth instance.
 *
 * ⚠ If one fails after a dependency bump, re-read the cited file and decide what the change MEANS —
 * do not relax the assertion to make it pass. Three of these are the difference between a working
 * account system and a silent data or App Store problem.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PKG = dirname(Bun.resolveSync('better-auth/package.json', import.meta.dir))
const read = (rel: string) => readFileSync(join(PKG, rel), 'utf8')

const AUTH_TS = readFileSync(join(import.meta.dir, '../src/auth.ts'), 'utf8')

/** The `/sign-in/email-otp` handler body — where signup-or-signin is decided. */
function otpSignInBody(): string {
  const src = read('dist/plugins/email-otp/routes.mjs')
  const start = src.indexOf('"/sign-in/email-otp"')
  expect(start).toBeGreaterThan(-1)
  return src.slice(start, start + 4000)
}

describe('email OTP: the sign-in route does signup too', () => {
  // THE reason there is no separate sign-up call anywhere in the app. If this stopped being true, a
  // brand-new rider's code would be rejected and nobody could create an account at all.
  test('creates the user when the address is unknown', () => {
    const body = otpSignInBody()
    expect(body).toContain('internalAdapter.createUser')
  })

  // ⚠ THIS IS WHAT MAKES THE FREE GRANT WORK ON THIS PATH. `FREE_DRIVE_CAP` is granted from
  // `databaseHooks.user.create.after` — the UNIVERSAL user-creation hook, not a per-route one — so a
  // new signup route inherits it only because creation goes through `internalAdapter.createUser`.
  // TODO #76 explicitly asked for a test on the GRANT rather than on the sign-in; this is it, and it
  // is a test of the hook's universality rather than of any one route.
  test('creation goes through the adapter that runs user.create hooks (so the free grant lands)', () => {
    const internal = read('dist/db/internal-adapter.mjs')
    const createUser = internal.slice(internal.indexOf('createUser: async'))
    expect(createUser.slice(0, 1200)).toContain('createWithHooks')
    // and our side still hangs the grant off that hook
    expect(AUTH_TS).toContain('ensureFreeGrant')
    expect(AUTH_TS).toMatch(/databaseHooks[\s\S]*?create:[\s\S]*?after:/)
  })

  // ⚠ Accounts born here are PROVEN from birth, which is precisely why they are immune to the
  // credential-wipe pinned below. If a bump made new users unverified, every rider who later set a
  // password would silently lose it on their next sign-in.
  test('a user created this way is emailVerified from birth', () => {
    expect(otpSignInBody()).toMatch(/emailVerified:\s*true/)
  })
})

describe('email OTP: the credential wipe that forced the backfill', () => {
  // ⚠ THE SHARPEST EDGE IN THIS WHOLE CHANGE. An OTP sign-in calls `revokeUnprovenAccountAccess`,
  // which DELETES every `credential` account row (i.e. the password) and all sessions when the user
  // is not verified. Skipper never had email verification, so both pre-existing accounts — the
  // founder's and `review@skipper.fm` — would have lost their passwords on first use of the new
  // default path. They were backfilled to emailVerified = true on 2026-08-05 (authorised), which is
  // ALSO what keeps App Review able to sign in at all.
  test('revokeUnprovenAccountAccess deletes credential rows for UNVERIFIED users only', () => {
    const src = read('dist/db/revoke-unproven-account-access.mjs')
    // the early return is the whole protection the backfill bought
    expect(src).toMatch(/if\s*\(!user\s*\|\|\s*user\.emailVerified\)\s*return/)
    expect(src).toContain('deleteAccount')
    expect(src).toContain('deleteUserSessions')
    expect(src).toMatch(/providerId\s*===\s*["']credential["']/)
  })

  test('the OTP sign-in route is one of its callers', () => {
    expect(read('dist/plugins/email-otp/routes.mjs')).toContain('revokeUnprovenAccountAccess')
  })
})

describe('INV-4: the anonymous row is still linked-and-deleted on the new paths', () => {
  // A new sign-in path that the anonymous plugin's matcher did NOT name would leave a live anonymous
  // session behind a freshly-created real account. It names ours explicitly — verified rather than
  // assumed, because this is exactly the kind of list a vendor edits quietly.
  test('the link matcher covers /sign-in* and the email-otp verify path', () => {
    const src = read('dist/plugins/anonymous/index.mjs')
    const matcher = src.slice(src.indexOf('matcher(ctx)'), src.indexOf('matcher(ctx)') + 700)
    expect(matcher).toContain('/sign-in')
    expect(matcher).toContain('/email-otp/verify-email')
  })
})

describe('App Store 5.1.1(v): a passwordless account can still delete itself', () => {
  // ⚠ THE BLOCKER THIS CHANGE HAD TO FIX. Settings used to send `deleteUser({ password })` behind a
  // `disabled={!password}` button; an account created by an emailed code has no password, so it
  // could never have been deleted from inside the app — a guaranteed rejection.
  test('deleteUser verifies a password only when one is SENT', () => {
    const src = read('dist/api/routes/update-user.mjs')
    const body = src.slice(src.indexOf('"/delete-user"'))
    // the guard is conditional on the body carrying a password...
    expect(body).toMatch(/if\s*\(ctx\.body\.password\)/)
    // ...and the field is optional on the wire
    expect(body).toMatch(/password:\s*z\.string\(\)[\s\S]{0,200}?\.optional\(\)/)
  })

  // ⚠ AND THE COROLLARY, which is why the app asks for an emailed code instead: the endpoint's own
  // middleware does NOT impose a freshness bar (that is `freshSessionMiddleware`, a different one),
  // so the server would accept `deleteUser({})` from any live session. The re-auth on the deletion
  // flow is OURS. If this ever starts asserting freshness, the app's code step becomes redundant —
  // but until then, removing it lowers the bar on the most destructive action in the product.
  test('/delete-user is NOT behind freshSessionMiddleware', () => {
    const src = read('dist/api/routes/update-user.mjs')
    const decl = src.slice(src.indexOf('"/delete-user"') - 400, src.indexOf('"/delete-user"') + 400)
    expect(decl).toContain('sensitiveSessionMiddleware')
    expect(decl).not.toContain('freshSessionMiddleware')
  })
})

describe('setPassword: why apps/api owns a route for it', () => {
  // Justifies ../src/password.ts existing at all. If a bump ever exposes this to clients, that
  // wrapper becomes removable — which is worth knowing rather than carrying forever.
  test('better-auth declares setPassword serverOnly (so authClient cannot call it)', () => {
    const src = read('dist/api/routes/update-user.mjs')
    const decl = src.slice(src.indexOf('const setPassword'), src.indexOf('const setPassword') + 300)
    expect(decl).toContain('createAuthEndpoint.serverOnly')
  })
})

describe('our config, which no typecheck can see', () => {
  test('emailOTP is registered and sends through the Resend mailer', () => {
    expect(AUTH_TS).toContain('emailOTP(')
    expect(AUTH_TS).toContain('sendVerificationOTP')
    expect(AUTH_TS).toContain('sendSignInCodeEmail')
  })

  // ⚠ Password stays ENABLED on purpose: App Review cannot receive an emailed code, and signs in as
  // review@skipper.fm with a password held in App Store Connect. Turning this off is a submission
  // failure, not a simplification. docs/guides/app-store-submission.md.
  test('email+password is still enabled as the fallback', () => {
    expect(AUTH_TS).toMatch(/emailAndPassword:\s*\{[\s\S]{0,2000}?enabled:\s*true/)
  })

  // The plugin's own limiter (3/60s per endpoint) is TIGHTER than this file's 100/60s baseline, and
  // every request here spends a real email at an address the caller chose. Passing our own numbers
  // would loosen it — so the absence of an override is the guard, and absence is exactly what a
  // future edit adds to without noticing.
  test('no rateLimit override on the emailOTP plugin', () => {
    const block = AUTH_TS.slice(AUTH_TS.indexOf('emailOTP('), AUTH_TS.indexOf('emailOTP(') + 3500)
    expect(block).not.toMatch(/rateLimit:/)
  })
})

describe("reviewFixedOtp: App Review's fixed sign-in code (founder, 2026-08-17)", () => {
  // Added after the 2026-08-17 rejection: the reviewer tapped "Send me a code" (the primary CTA),
  // could not receive the email, and never found the password fallback — so their NATURAL path now
  // works: a sign-in code for the review address is always REVIEW_OTP_CODE. The SCOPING below is
  // the entire security argument (one address, one OTP type, off when unset), which is why it gets
  // a real unit test where the rest of this file settles for source pins.
  const ENV_KEY = 'REVIEW_OTP_CODE'
  const saved = process.env[ENV_KEY]
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = saved
  })

  test('fixed code for exactly review@skipper.fm + sign-in, case-insensitively', async () => {
    const { reviewFixedOtp } = await import('../src/auth')
    process.env[ENV_KEY] = '123456'
    expect(reviewFixedOtp('review@skipper.fm', 'sign-in')).toBe('123456')
    expect(reviewFixedOtp('Review@Skipper.FM', 'sign-in')).toBe('123456')
    // any other address, any other type, falls through to the plugin's random generator
    expect(reviewFixedOtp('rider@example.com', 'sign-in')).toBeUndefined()
    expect(reviewFixedOtp('review@skipper.fm', 'forget-password')).toBeUndefined()
    expect(reviewFixedOtp('review@skipper.fm', 'email-verification')).toBeUndefined()
  })

  test('unset env = feature off, even for the review address', async () => {
    const { reviewFixedOtp } = await import('../src/auth')
    delete process.env[ENV_KEY]
    expect(reviewFixedOtp('review@skipper.fm', 'sign-in')).toBeUndefined()
  })

  // ⚠ THE VENDOR SHAPE THE `undefined` RETURN RESTS ON. Every better-auth call site must read
  // `opts.generateOTP(...) || defaultOTPGenerator(opts)` — the fallback is what keeps every OTHER
  // address on random codes. A bump that drops the `||` would silently hand EVERY rider an empty
  // code or crash the send; this is the assertion that turns that into a red test instead.
  test('every vendor generateOTP call site falls back on a falsy return', () => {
    for (const rel of ['dist/plugins/email-otp/routes.mjs', 'dist/plugins/email-otp/index.mjs']) {
      const src = read(rel)
      const sites = src.split('opts.generateOTP(').slice(1)
      expect(sites.length).toBeGreaterThan(0)
      for (const site of sites) {
        expect(site.slice(0, 120)).toContain('|| defaultOTPGenerator(')
      }
    }
  })

  test('the plugin is actually wired to reviewFixedOtp (not just defined)', () => {
    const block = AUTH_TS.slice(AUTH_TS.indexOf('emailOTP('), AUTH_TS.indexOf('emailOTP(') + 3500)
    expect(block).toMatch(/generateOTP:\s*\(\{\s*email,\s*type\s*\}\)\s*=>\s*reviewFixedOtp\(email,\s*type\)/)
  })
})
