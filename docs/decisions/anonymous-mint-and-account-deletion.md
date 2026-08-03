# The anonymous mint is not account creation — no in-app delete for anonymous riders

> **Status:** DECIDED 2026-08-03 (founder). The anonymous session minted on first launch does **not**
> constitute "account creation" under App Store Guideline **5.1.1(v)**, so 1.1 ships with **no in-app
> delete affordance in the anonymous branch** of `apps/mobile/app/settings.tsx`. This CLOSES
> [drives-first-1-1.md](../designs/drives-first-1-1.md) **RISK-3**, which asked for exactly this call
> before submission. Real accounts are unaffected — their in-app deletion is live and total
> ([account-deletion-and-recovery.md](account-deletion-and-recovery.md)). ⚠ This record also CORRECTS
> the reason the code gave for the omission: it named the wrong endpoint, and the thing it called
> impossible is in fact mounted and callable today. Nothing is built or unbuilt by this decision — it
> is a decision **not** to build.

## The question

The app mints an anonymous session on first launch (1.1's D16 — the planner is the open front door, so
a rider gets a session before they ever see a sign-up screen). That writes a real `user` row on the
server. 5.1.1(v) says an app that supports **account creation** must also let a user **delete** the
account from inside the app. Does the mint trip that?

## The answer, and why

**No — and 1.1 ships without the affordance.** Four things carry it, and they are independent:

- **The flow the guideline is about already complies.** Skipper's actual account-creation path — the
  sign-up screen behind the "Make this drive" wall — has in-app deletion today: Settings → Delete
  account → `deleteUser` → `purgeUserData` on `databaseHooks.user.delete.before`, immediate and total
  across the soft-ref tables Better Auth's own cascade cannot reach. The guideline's requirement is
  satisfied for every account a rider actually creates.
- **An anonymous row holds no rider data, by invariant.** No `drives` and no `credit_entries` row may
  reference an anonymous user id (CLAUDE.md's anonymous invariant; the tier gate on `POST /drives` and
  the signup grant's anonymous skip are what make it structural rather than a habit). There is nothing
  to erase. A delete button in that branch would erase an empty shell and call it a privacy control.
- **The rider never created anything they would recognise as an account.** No email, no password, no
  screen, no consent moment. The same settings screen already refuses to print a "Riding as …" line in
  this branch for precisely that reason — the anonymous plugin writes a synthetic `temp-…@….com` and
  the name "Anonymous", and *"printing either tells the rider they have an account they do not have"*.
  Advertising **Delete account** in the branch that deliberately hides every other sign of an account
  would contradict the screen's own rule, and would be the first thing in the app to inform a rider
  they have one.
- **The cost of being wrong is bounded and cheap** — see Risk accepted.

## ⚠ The correction worth preserving: the old reason cited the wrong endpoint

The comment in the anonymous branch of `apps/mobile/app/settings.tsx` justified the omission as a
technical impossibility: *"`deleteUser` sits behind better-auth's `sensitiveSessionMiddleware` and an
anonymous user has no credential to re-auth with, so the button could only ever return an error."*
RISK-3 in the 1.1 spec repeats it. **That reasons about `deleteUser`, which is not the endpoint an
anonymous rider would call.**

Verified in the installed source (better-auth **1.6.23**, `dist/plugins/anonymous/index.mjs`):

- the anonymous plugin **mounts its own `POST /delete-anonymous-user`**, whose handler refuses unless
  `session.user.isAnonymous`, then deletes the sessions and the user and clears the session cookie;
- it is **LIVE here** — the endpoint is disabled only by `disableDeleteAnonymousUser`, and
  `apps/api/src/auth.ts` passes `anonymous()` nothing but `onLinkAccount`;
- the middleware it *does* sit behind asks for an **authoritative session and nothing else** — in this
  version `sensitiveSessionMiddleware` is a session read that bypasses the cookie cache, then a 401 if
  there is none. **No password, no re-auth.** The credential argument was never the barrier.

So this is a **DECISION**, not a limitation, and it has to survive on the four points above rather than
on "we couldn't anyway". That distinction is the whole reason this record exists: a justification that
rests on a false mechanism is one dependency bump away from silently becoming a bug report.

**If a future App Review disagrees, the fix is small.** Call `deleteAnonymousUser` from the anonymous
branch. ⚠ The one non-obvious part is what happens after success: it deletes the session, and **the
mint's guard is module-level**, so the app is left session-less until the next cold start — the same
sharp edge that is already the stated reason there is no *Sign out* control in this branch. Handle that
(re-mint, or route the rider somewhere that survives a null session) rather than shipping a button that
leaves the app in a state nothing else in the flow can produce.

## Risk accepted

If a reviewer construes the mint as account creation, the app is rejected and it costs **one review
cycle** — the fix above, a build, and a resubmission. No data is at stake either way, which is what
makes the trade lopsided enough to take: the downside is calendar time, and the alternative is shipping
a control that tells riders they have an account in order to offer to delete something that holds
nothing.
