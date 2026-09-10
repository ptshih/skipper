/** The one listing field Apple permits changing on the live version without submission.
 * Keep this path separate from version metadata: a newer draft must never steal the update,
 * and a promotional edit must not carry review credentials or a description PATCH with it.
 * https://developer.apple.com/documentation/appstoreconnectapi/app-store-version-localizations
 */
export const PROMOTIONAL_TEXT_MAX_LENGTH = 170

type AscRequest = (method: string, path: string, body?: unknown) => Promise<any>

export async function updatePromotionalText(options: {
  asc: AscRequest
  appId: string
  text: string
  apply: boolean
  report: (field: string, live: string, intended: string) => boolean
  log?: (message: string) => void
}) {
  const { asc, appId, apply, report } = options
  const text = options.text.trim()
  const log = options.log ?? console.log
  if (!text || text.length > PROMOTIONAL_TEXT_MAX_LENGTH) throw new Error('Promotional text must contain 1–170 characters')
  const versions = await asc('GET', `/v1/apps/${appId}/appStoreVersions?limit=200`)
  // Refuse an incomplete inventory rather than relying on undocumented response ordering.
  if (versions.links?.next) throw new Error('Version inventory is paginated; cannot identify the unique live iOS version')
  const live = versions.data.filter((v: any) => v.attributes.platform === 'IOS'
    && ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(v.attributes.appVersionState ?? v.attributes.appStoreState))
  if (live.length !== 1) throw new Error(`Expected one live iOS version; found ${live.length}`)
  const version = live[0]
  const localizations = await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`)
  if (localizations.links?.next) throw new Error('Localization inventory is paginated; cannot identify en-US safely')
  const english = localizations.data.filter((l: any) => l.attributes.locale === 'en-US')
  if (english.length !== 1) throw new Error('Expected exactly one en-US localization; no fallback language will be edited')
  const loc = english[0]
  log(`Promotional text only — live iOS ${version.attributes.versionString} · en-US`)
  const changed = report('promotionalText', loc.attributes.promotionalText ?? '', text)
  if (!changed) {
    log('✓ Nothing to do — live promotional text already matches.')
    return { changed: false, applied: false, versionId: version.id }
  }
  if (!apply) {
    log('PREVIEW ONLY — nothing written. Description, review notes, builds and submissions are untouched.')
    return { changed: true, applied: false, versionId: version.id }
  }
  // Re-read the selected resources immediately before writing so a long preview cannot
  // silently overwrite another operator's copy or follow a superseded version record.
  const currentVersion = await asc('GET', `/v1/appStoreVersions/${version.id}`)
  const state = currentVersion.data.attributes.appVersionState ?? currentVersion.data.attributes.appStoreState
  if (!['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(state)) throw new Error('Selected version is no longer live; preview again')
  const current = await asc('GET', `/v1/appStoreVersionLocalizations/${loc.id}`)
  if (current.data.attributes.locale !== 'en-US'
    || (current.data.attributes.promotionalText ?? '') !== (loc.attributes.promotionalText ?? '')) {
    throw new Error('Promotional text changed during preparation; preview again')
  }
  // ASC offers no atomic compare-and-swap for this field. The pre-write read narrows
  // the race; the readback proves the resulting value, not protection against all races.
  await asc('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
    data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { promotionalText: text } },
  })
  const after = await asc('GET', `/v1/appStoreVersionLocalizations/${loc.id}`)
  if (after.data.attributes.promotionalText?.trim() !== text) throw new Error('Promotional text read-back mismatch')
  log('✓ Promotional text updated and verified. No version submission was created.')
  return { changed: true, applied: true, versionId: version.id }
}
