#!/usr/bin/env bun
// Push the 1.1 listing metadata to App Store Connect — SAFE BY DEFAULT: previews a diff unless
// `--apply` (docs/guides/ops-scripts-sop.md). Spends no GCP credits and calls no paid API; the only
// cost of getting it wrong is a wrong LISTING, which is exactly why it reads back before it writes.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// The listing is the one launch surface with no test to fail, and this project has already been bitten
// twice by that: the App Review notes carried three material errors under a "paste verbatim" heading
// (each good for a rejection), and a stale age rating sat in the doc long enough to do damage if
// re-pasted. Hand-pasting four fields across a web form, from a 900-line document that has drifted
// before, is the failure mode. This makes it a diff.
//
// ⚠ **THE COPY LIVES IN THE DOC, NOT HERE.** This script EXTRACTS the fenced blocks marked
// `<!-- asc:<field> -->` out of docs/guides/app-store-submission.md. That is deliberate and it is the
// whole design: a second copy of the description in a script is a second thing to update, and the one
// nobody remembers. If you find yourself pasting listing prose into this file, stop — edit the doc.
//
// ── RUN ──────────────────────────────────────────────────────────────────────────────────────────
//   bun run asc:metadata                 # preview: live vs intended, per field, with char counts
//   bun run asc:metadata -- --apply      # WRITE (asks nothing; be sure)
//   bun run asc:metadata -- --version=1.1.0   # also rename the version record (default: leave alone)
//
// Auth reuses the ASC API key already set up for `tf:feedback` (ASC_KEY_ID / ASC_ISSUER_ID /
// ASC_APP_ID + keys/AuthKey_<ID>.p8). That key has WRITE scope — §11b set most of this listing with it.
import { readFileSync, existsSync } from 'node:fs'

const BASE = 'https://api.appstoreconnect.apple.com'
const DOC = 'docs/guides/app-store-submission.md'

// Apple's caps. ⚠ Counted in JS string length; Apple counts the same way for these fields, and every
// character of the description below is ASCII-or-punctuation, so there is no surrogate-pair trap here.
// A field that exceeds its cap is REJECTED by the API, not truncated — so this fails before writing.
const CAPS: Record<string, number> = {
  promotionalText: 170,
  description: 4000,
  reviewNotes: 4000,
}

const argv = process.argv.slice(2)
const has = (n: string) => argv.includes(`--${n}`)
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')

const APPLY = has('apply')
const versionString = flag('version')

const keyId = process.env.ASC_KEY_ID
const issuerId = process.env.ASC_ISSUER_ID
const appId = process.env.ASC_APP_ID
const keyPath = process.env.ASC_API_KEY_PATH ?? (keyId ? `keys/AuthKey_${keyId}.p8` : undefined)

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}
if (!keyId || !issuerId || !appId) die('Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_APP_ID (dotenvx does this).')
if (!keyPath || !existsSync(keyPath)) die(`Private key not found at "${keyPath}".`)

// ── auth: ES256 JWT via Web Crypto (raw r‖s sig = JOSE, no dep) — same as pull-testflight-feedback.ts
let cachedKey: CryptoKey | null = null
async function jwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  cachedKey ??= await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(
      readFileSync(keyPath!, 'utf8')
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, ''),
      'base64',
    ),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const body = b64({ iss: issuerId, iat: now, exp: now + 60 * 20, aud: 'appstoreconnect-v1' })
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cachedKey,
    new TextEncoder().encode(`${head}.${body}`),
  )
  return `${head}.${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`
}

async function asc(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await jwt()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return {}
  const text = await res.text()
  if (!res.ok) die(`ASC ${res.status} ${method} ${path}\n${text.slice(0, 800)}`)
  return text ? JSON.parse(text) : {}
}

/**
 * Pull a marked fenced block out of the doc.
 *
 * ⚠ Anchored on the `<!-- asc:<field> -->` comment rather than on a heading, because headings here
 * carry prose ("**NOT YET ENTERED**") that will change the day someone enters it — and an extractor
 * that silently stops matching would push nothing while reporting success.
 */
function blockFromDoc(doc: string, field: string): string {
  const marker = `<!-- asc:${field}`
  const at = doc.indexOf(marker)
  if (at < 0) die(`No \`${marker}\` marker in ${DOC}. Someone removed it — re-attach it to the fence.`)
  const fenceOpen = doc.indexOf('```', at)
  const bodyStart = doc.indexOf('\n', fenceOpen) + 1
  const fenceClose = doc.indexOf('\n```', bodyStart)
  if (fenceOpen < 0 || fenceClose < 0) die(`The \`${marker}\` marker is not followed by a fenced block.`)
  return doc.slice(bodyStart, fenceClose).trim()
}

/**
 * `{{REVIEW_OTP_CODE}}` → the demo account's fixed sign-in code (apps/api/src/auth.ts
 * `reviewFixedOtp`; submission guide §15d). The committed doc stays credential-free — same rule as
 * the demo password: ASC + encrypted env, never git — while the LIVE notes carry the value.
 * Substituted before the diff AND the push, so "already matches" compares what Apple actually
 * serves. Fails loudly when the placeholder exists with no env value: pushing the literal
 * placeholder would hand the reviewer a code that types as nonsense.
 */
function fillPlaceholders(field: string, text: string): string {
  if (!text.includes('{{REVIEW_OTP_CODE}}')) return text
  const code = process.env.REVIEW_OTP_CODE
  if (!code) die(`${field} contains {{REVIEW_OTP_CODE}} but REVIEW_OTP_CODE is unset — run under dotenvx.`)
  return text.replaceAll('{{REVIEW_OTP_CODE}}', code)
}

function report(field: string, live: string, next: string): boolean {
  const cap = CAPS[field]
  const same = live.trim() === next.trim()
  const over = cap !== undefined && next.length > cap
  const head = same ? '  =' : over ? '  ✗' : '  →'
  const count = cap === undefined ? `${next.length} chars` : `${next.length}/${cap}`
  console.log(`${head} ${field.padEnd(17)} ${same ? 'already matches' : 'WOULD CHANGE'} · ${count}${over ? '  ⚠ OVER CAP' : ''}`)
  if (over) die(`${field} is ${next.length} chars, over Apple's ${cap}. The API rejects rather than truncates — fix the doc.`)
  if (!same) {
    const preview = (s: string) => (s.length > 110 ? `${s.slice(0, 110).replace(/\n/g, ' ⏎ ')}…` : s.replace(/\n/g, ' ⏎ '))
    console.log(`      live: ${live ? preview(live) : '(empty)'}`)
    console.log(`      next: ${preview(next)}`)
  }
  return !same
}

async function main() {
  const doc = readFileSync(DOC, 'utf8')
  const intended = {
    promotionalText: blockFromDoc(doc, 'promotionalText'),
    description: blockFromDoc(doc, 'description'),
    reviewNotes: fillPlaceholders('reviewNotes', blockFromDoc(doc, 'reviewNotes')),
  }

  // The editable version record. ⚠ Only ONE version is ever in an editable state; picking the newest
  // by created date rather than filtering on a state name keeps this working across Apple's renames
  // (appStoreState → appVersionState), which have already broken reads in this repo once.
  const versions = await asc('GET', `/v1/apps/${appId}/appStoreVersions?limit=5`)
  const version = versions.data?.[0]
  if (!version) die('No appStoreVersions on this app.')
  const state = version.attributes.appStoreState ?? version.attributes.appVersionState

  console.log('\n' + '='.repeat(88))
  console.log(`ASC METADATA — app ${appId} · version ${version.attributes.versionString} · ${state}`)
  console.log(`copy source: ${DOC} (the doc is the ONE home; this script only carries it)`)
  console.log('='.repeat(88))

  if (state === 'READY_FOR_SALE' || state === 'WAITING_FOR_REVIEW' || state === 'IN_REVIEW') {
    console.log(
      `\n⚠ This version is ${state}. Localization edits may be refused or may restart a review queue.`,
    )
  }

  // ⚠ BUILD vs VERSION-STRING MISMATCH. Apple only OFFERS builds whose short version matches the
  // record (§11b), but it does not un-attach one when the record is renamed underneath it — so
  // renaming 1.0.0 → 1.1.0 leaves the old binary sitting on the new listing, and on 2026-08-03 that is
  // exactly what happened: a 1.1.0 record still carrying build 15, the pre-1.1 roam client that 404s
  // against the deployed API. Nothing in ASC flags it. Submitting in that state ships the wrong app
  // under the right number, which is the worst available outcome, so this shouts.
  const attached = await asc('GET', `/v1/appStoreVersions/${version.id}/build`)
  const attachedShort = attached?.data?.attributes?.version
  if (attached?.data) {
    const buildRes = await asc('GET', `/v1/builds/${attached.data.id}?include=preReleaseVersion`)
    const pre = buildRes.included?.find((i: any) => i.type === 'preReleaseVersions')
    const shortVersion = pre?.attributes?.version
    if (shortVersion && shortVersion !== version.attributes.versionString) {
      console.log(
        `\n⚠ ATTACHED BUILD MISMATCH: build ${attachedShort} is short-version ${shortVersion}, but this\n` +
          `  record is ${version.attributes.versionString}. Detach it (or attach a matching build) before\n` +
          `  submitting — ASC will not warn you.`,
      )
    }
  }

  const locs = await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)
  const loc = locs.data?.find((l: any) => l.attributes.locale === 'en-US') ?? locs.data?.[0]
  if (!loc) die('No en-US appStoreVersionLocalization.')

  const detailRes = await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)
  const detail = detailRes.data

  console.log('\nFIELDS')
  let changed = false
  changed = report('promotionalText', loc.attributes.promotionalText ?? '', intended.promotionalText) || changed
  changed = report('description', loc.attributes.description ?? '', intended.description) || changed
  changed = report('reviewNotes', detail?.attributes?.notes ?? '', intended.reviewNotes) || changed
  if (versionString) {
    changed = report('versionString', version.attributes.versionString ?? '', versionString) || changed
  } else {
    console.log(
      `  · versionString    left alone (${version.attributes.versionString}) — pass --version=1.1.0 to rename`,
    )
  }

  // Things this script deliberately does NOT touch, named so their absence is never read as "done".
  console.log('\nNOT TOUCHED BY THIS SCRIPT (§ numbers are app-store-submission.md)')
  console.log('  · keywords + subtitle — version-locked and unchanged for 1.1 (§5)')
  console.log('  · the App Privacy label (§8) — Apple exposes NO public API for it; hand entry, and the')
  console.log('    1.1 free-text question is a founder call, not a paste')
  console.log('  · screenshots (§9) — uploaded 2026-08-06 via the ASC assets API, not by this script')
  console.log('  · the demo account password — lives in ASC and nowhere else, on purpose')
  console.log('  · the submission itself — this only stages the listing')

  if (!changed) {
    console.log('\n✓ Nothing to do — the live listing already matches the doc.\n')
    return
  }
  if (!APPLY) {
    console.log('\nPREVIEW ONLY — nothing was written. Re-run with `--apply` to push the changes above.\n')
    return
  }

  console.log('\nApplying…')
  await asc('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: loc.id,
      attributes: { promotionalText: intended.promotionalText, description: intended.description },
    },
  })
  console.log('  ✓ promotionalText + description')

  if (detail) {
    await asc('PATCH', `/v1/appStoreReviewDetails/${detail.id}`, {
      data: { type: 'appStoreReviewDetails', id: detail.id, attributes: { notes: intended.reviewNotes } },
    })
  } else {
    await asc('POST', '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes: { notes: intended.reviewNotes },
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
      },
    })
  }
  console.log('  ✓ App Review notes')

  if (versionString) {
    await asc('PATCH', `/v1/appStoreVersions/${version.id}`, {
      data: { type: 'appStoreVersions', id: version.id, attributes: { versionString } },
    })
    console.log(`  ✓ versionString → ${versionString}`)
  }

  // Read back rather than trusting the 200s. This whole script exists because "we pushed it" and "it
  // is what's live" have already come apart in this project.
  //
  // ⚠ reviewNotes IS READ BACK SEPARATELY AND MUST STAY THAT WAY. It lives on `appStoreReviewDetail`,
  // a different resource from the localization, so the localization GET below says NOTHING about it.
  // Until 2026-08-06 this block checked only promotionalText + description while `✓ App Review notes`
  // was printed straight after the PATCH — so the field with the highest rejection cost in the whole
  // listing was the one field the script asserted without looking. Absence of a 4xx is not evidence
  // the bytes landed (CLAUDE.md: "assert the work happened").
  const after = await asc('GET', `/v1/appStoreVersionLocalizations/${loc.id}`)
  const okPromo = after.data.attributes.promotionalText?.trim() === intended.promotionalText
  const okDesc = after.data.attributes.description?.trim() === intended.description
  const afterDetail = await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)
  const okNotes = afterDetail?.data?.attributes?.notes?.trim() === intended.reviewNotes
  console.log(
    `\nRead-back: promotionalText ${okPromo ? '✓' : '✗'} · description ${okDesc ? '✓' : '✗'}` +
      ` · reviewNotes ${okNotes ? '✓' : '✗'}`,
  )
  const allOk = okPromo && okDesc && okNotes
  console.log(
    allOk
      ? '\n✓ Listing updated. Flip §12\'s "1.1 metadata entered" checkbox.\n'
      : '\n⚠ Read-back MISMATCH — check the listing by hand before submitting.\n',
  )
  if (!allOk) process.exitCode = 1
}

main().catch((e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
