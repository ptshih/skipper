// What the app tells the server about ITSELF — one request header, parsed here so the client that
// emits it and the server that reads it can never disagree about the grammar.
//
// WHY THIS EXISTS. Until 2026-07-30 the app sent the server nothing but a Cookie, so the server could
// not tell a 1.0.1 rider from a 1.2.0 one. That is not a theoretical gap: AREA-triggered district
// tellings need a polygon the shipped client cannot fire, and with no way to tell clients apart the
// only options were "send districts to everyone" and "send them to no one". A `?caps=area` query
// param was built and deleted the same day; this is its general form.
//
// ⚠ `GET /version` does NOT do this job and never will. It is a client-side SELF-check — the app
// fetches the policy and decides whether to nudge or wall itself. It is a FLOOR (force everyone to
// upgrade), not a switch (serve different clients different content). Two different problems.
//
// ⚠ THE HEADER ONLY HELPS BUILDS THAT SHIP WITH IT. Every already-installed rider sends nothing,
// forever — so "absent" is not a transitional state, it is a permanent client class, and the least
// capable one. That is why the parse below degrades to an EMPTY capability set rather than throwing
// or defaulting to permissive: the safe reading of silence is "assume it can do nothing".
//
// ⚠ CLIENT-ASSERTED, THEREFORE FORGEABLE. Fine for shaping content GEOMETRY; never use it to gate
// entitlement, credits, staged content, or presigned audio — those stay on the session. And a
// capability is only as honest as the build asserting it, so a server-side fallback (e.g. the capped
// point radius on an area telling) stays the backstop even for a client that claims the capability.
//
// ⚠ COARSE ON PURPOSE — version + capabilities, never a device or install id. The client sends this
// on deliberately ANONYMOUS calls too (`GET /roam` carries the rider's live lat/lng and omits the
// session Cookie precisely so coordinates are never linked to a person). A per-install identifier
// here would quietly undo that and make the App Privacy label wrong.

/** The one header. Lowercase on the server side (Hono normalizes), but sent in this casing. */
export const CLIENT_IDENTITY_HEADER = 'X-Skipper-Client'

/** A hard ceiling on what we will parse — the header is attacker-controllable and ends up in Cloud
 *  Run access logs. Real values are ~30 chars. */
const MAX_HEADER_LEN = 256

/** The header's grammar, hoisted: `parseClientIdentity` runs in middleware ahead of EVERY request, and
 *  `CAP_TOKEN_RE` is the one definition shared by the emitter and the parser — so the build that writes
 *  a token and the server that reads it cannot drift on what a legal token looks like. Neither is
 *  `/g`, so sharing one instance carries no `lastIndex` state between calls. */
const VERSION_RE = /^[0-9][0-9a-zA-Z.\-+]*$/
const CAP_TOKEN_RE = /^[a-z0-9_-]+$/

/**
 * The capability vocabulary — ONE home, because the app emits these strings and the API branches on
 * them. A token names something the CLIENT can DO that an older build cannot.
 *
 * ⚠ A token is never re-used with a different meaning. Retire one and pick a new word instead:
 * the installed base cannot be updated retroactively, so an old build asserting `area` will keep
 * asserting it forever and would silently claim whatever the word means next.
 */
export const CLIENT_CAPS = {
  /** Can fire an AREA trigger — containment in a convex hull rather than proximity to a point.
   *  Shipped in the mobile client 2026-07-30; see @skipper/engine `area.ts`. */
  area: 'area',
} as const

export type ClientCap = (typeof CLIENT_CAPS)[keyof typeof CLIENT_CAPS]

/** What the server knows about the caller's build. `version` is null when the header is absent or
 *  unparseable — i.e. an old client, which is exactly what it is. */
export interface ClientIdentity {
  version: string | null
  caps: ReadonlySet<string>
}

/** The permanent shape of "an already-installed rider who sends nothing". Exported so callers can
 *  name the least-capable case instead of constructing it. */
export const UNKNOWN_CLIENT: ClientIdentity = { version: null, caps: new Set() }

/**
 * Build the header value: `v=1.0.1; caps=area`.
 *
 * Pure, so it unit-tests without a native module — the mobile side reads
 * `Constants.expoConfig?.version` at the call site and passes it in.
 *
 * ⚠ An absent version omits the field rather than emitting the string "undefined", which would parse
 * back as a version and could satisfy a comparison by accident.
 */
export function clientIdentityHeader(
  version: string | null | undefined,
  caps: readonly string[] = [],
): string {
  const parts: string[] = []
  if (version) parts.push(`v=${version}`)
  // Sorted so the header is stable across builds — it lands in access logs, and a set whose order
  // wobbles would look like a changing client.
  const clean = [...new Set(caps)].filter((c) => c && CAP_TOKEN_RE.test(c)).sort()
  if (clean.length > 0) parts.push(`caps=${clean.join(',')}`)
  return parts.join('; ')
}

/**
 * Parse the header. TOTAL — never throws, never rejects, and degrades to {@link UNKNOWN_CLIENT}.
 *
 * ⚠ FAIL-SOFT IS THE POINT, not laziness. This runs in middleware ahead of every route including the
 * env-free `GET /health`, on a value any caller controls. A 400 (or a throw) on a malformed header
 * would turn a client-side formatting bug into a self-inflicted outage on routes that currently
 * cannot fail this way.
 *
 * Unknown keys and unknown capability tokens are IGNORED, never rejected — a newer client must be
 * able to announce a capability this server has never heard of without being downgraded for it.
 */
export function parseClientIdentity(raw: string | null | undefined): ClientIdentity {
  if (!raw || raw.length > MAX_HEADER_LEN) return UNKNOWN_CLIENT
  let version: string | null = null
  const caps = new Set<string>()
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1).trim()
    if (key === 'v') {
      // Only a plausible version string — never a free-form label that a comparison might mishandle.
      if (VERSION_RE.test(value)) version = value
    } else if (key === 'caps') {
      for (const tok of value.split(',')) {
        const t = tok.trim().toLowerCase()
        if (t && CAP_TOKEN_RE.test(t)) caps.add(t)
      }
    }
  }
  return { version, caps }
}

/** Does this client claim the capability? The whole point of routing every check through one helper
 *  is that "absent header" and "header without the token" answer identically, by construction. */
export function clientCan(identity: ClientIdentity, cap: ClientCap): boolean {
  return identity.caps.has(cap)
}
