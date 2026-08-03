import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Guards on the marketing site's LEGAL surface — the pages App Review and a regulator actually open.
// There is no other test in apps/site and this deliberately is not a rendering test: Astro's build
// already proves these compile. What it cannot prove is that they still EXIST, still say something,
// and still publish the right contact address.
const PAGES_DIR = join(import.meta.dir, '..', 'src', 'pages')
const read = (f: string) => readFileSync(join(PAGES_DIR, f), 'utf8')

/** The three the App Store listing links at. `docs/guides/app-store-submission.md` §12 checks all
 *  three return 200 at submission time; a rename or deletion between releases breaks the listing
 *  links and is a rejection, with nothing in the build failing first. */
const REQUIRED_PAGES = ['privacy.astro', 'terms.astro', 'support.astro']

/** The ONE published contact address. It is simultaneously the App Store support contact, the privacy
 *  contact, and the NRS 603A designated request address with a 60-day statutory clock. */
const CONTACT = 'hello@skipper.fm'

describe('the pages the App Store links at', () => {
  test('all three exist', () => {
    const present = readdirSync(PAGES_DIR)
    for (const page of REQUIRED_PAGES) expect(present).toContain(page)
  })

  test('none has been emptied to a stub', () => {
    // A legal page that builds and returns 200 while saying nothing passes every other check we
    // have. Not a style rule — a floor.
    for (const page of REQUIRED_PAGES) {
      expect(read(page).length).toBeGreaterThan(2_000)
    }
  })

  test('each names the contact address', () => {
    for (const page of REQUIRED_PAGES) {
      expect(read(page)).toContain(CONTACT)
    }
  })
})

describe('published contact addresses', () => {
  const pages = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.astro'))

  test('every mailto: on the site points at the one contact address', () => {
    // ⚠ THE REGRESSION THIS EXISTS FOR: a personal address reaching a published page. The rule is
    // that every PUBLISHED address is hello@skipper.fm — deliberately narrow to src/pages, because
    // the founder's personal address legitimately appears elsewhere as an ACCOUNT IDENTITY (GCP,
    // IAP, Expo) and rewriting those would break real logins.
    const found = new Set<string>()
    for (const page of pages) {
      for (const m of read(page).matchAll(/mailto:([^"'\s>?]+)/g)) found.add(m[1]!)
    }
    // Guard against the assertion going vacuous if the markup changes shape: there IS at least one.
    expect(found.size).toBeGreaterThan(0)
    expect([...found]).toEqual([CONTACT])
  })

  test('no page leaks a personal or placeholder address', () => {
    // feedback@ was a real placeholder that shipped in builds 15 and 16 before anyone noticed.
    for (const page of pages) {
      const src = read(page)
      expect(src).not.toContain('gmail.com')
      expect(src).not.toContain('feedback@')
      expect(src).not.toContain('example.com')
    }
  })
})
