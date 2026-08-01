// Create a Drive (V2) — the rider PICKS a start + end from the region's real narratable anchors (no
// free text, no geocoding), we preview the road-snapped route on a map BEFORE spending a credit, then
// generate. States behind one screen: FORM (region + FROM/TO pickers) → [anchor PICKER overlay] →
// PROPOSING ("thinking") → CONFIRM (map-hero) → GENERATING → the new drive's preview.
//
// Endpoints are grounded by construction (a picked anchor carries exact coords), so the create flow
// has NO endpoint-guessing: the route + the (reused shared) narration selection are deterministic
// server-side. Account-gated: the first action 401s an anonymous rider into the AccountGate.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, FlatList, Pressable, StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import {
  ApiError,
  createDrive,
  errorMessage,
  listAnchors,
  listRegions,
  proposeDrive,
  type DriveProposal,
  type Region,
  type RegionAnchor,
} from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { useTheme } from '@/theme'
import { border, radius, space } from '@/theme/tokens'
import { AccountGate, Badge, Button, Divider, FilterChip, Icon, Input, Screen, StateView, Text } from '@/ui'
import { DriveMap, type DriveMapStop } from '@/ui/DriveMap'

type Phase = 'form' | 'proposing' | 'confirm' | 'generating'

// Persona-voiced "thinking" lines, cycled while the backend works (theatrical for v2; the real
// calls are only a few seconds — never padded past them).
const PROPOSING_LINES = [
  'Charting your route…',
  'Scouting the roadside…',
  'Rounding up the good stories…',
]
const GENERATING_LINES = [
  'Plotting the drive…',
  'Cueing up the skipper…',
  'Almost ready to roll…',
]

// A v4 UUID for the create idempotency key (sent as createDrive.idempotencyKey, stable across retries
// of one logical create). Uses the platform crypto when present, else a Math.random v4 — this key
// needs UNIQUENESS to dedupe a retry, not unguessability, and Hermes ships no guaranteed crypto global.
function uuidV4(): string {
  const cr = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cr?.randomUUID) return cr.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// An anchor → the wire endpoint shape (drops `kind`).
/** What a request may name an anchor by: its `places` id, never its coordinates. The server re-asserts
 *  `endpoint_eligible` and 400s before any billed Routes call, so an off-list point is unrepresentable
 *  on the wire rather than merely discouraged (INV-1). */
const idOf = (a: RegionAnchor) => a.id
// Two picks are the same place (a degenerate one-way route → nudge to a round trip).
const samePlace = (a: RegionAnchor | null, b: RegionAnchor | null): boolean =>
  !!a && !!b && a.lat === b.lat && a.lng === b.lng

export default function CreateDriveScreen() {
  const router = useRouter()
  const theme = useTheme()

  const [regions, setRegions] = useState<Region[] | null>(null)
  const [regionsError, setRegionsError] = useState(false)
  const [regionId, setRegionId] = useState<string | null>(null)

  // The region's pickable anchors (real places + exact coords) and the rider's picks. A round-trip
  // (loop) uses start + a distinct MIDPOINT (turnaround); a one-way uses start + end. A bare
  // start==end is a degenerate zero-distance route, so loops route start→midpoint→start instead.
  const [anchors, setAnchors] = useState<RegionAnchor[] | null>(null)
  const [anchorsError, setAnchorsError] = useState(false)
  const [start, setStart] = useState<RegionAnchor | null>(null)
  const [end, setEnd] = useState<RegionAnchor | null>(null)
  const [mid, setMid] = useState<RegionAnchor | null>(null)
  const [loop, setLoop] = useState(false)
  const [picking, setPicking] = useState<'start' | 'end' | 'mid' | null>(null)
  const [query, setQuery] = useState('')

  const [phase, setPhase] = useState<Phase>('form')
  const [proposal, setProposal] = useState<DriveProposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)

  // The confirm map's puck sits at the start (static) — DriveMap wants a progress Animated.Value.
  const mapProgress = useRef(new Animated.Value(0)).current

  // Synchronous in-flight guard for the credit-spending create. setPhase('generating') is async, so
  // a fast double-tap on "Make this drive" would fire two POST /drives before React unmounts the
  // confirm view, and the rider over-spends a credit. Mirrors home's navigatingRef. (audit #4)
  const creatingRef = useRef(false)
  // Stable idempotency key for one logical create: minted once per proposal, REUSED across retries so a
  // lost-ACK network retry dedupes server-side (the server uses it as the drive id → no second drive, no
  // second charged credit). Reset to null on each new proposal (a new route is a new logical create).
  const idempotencyKeyRef = useRef<string | null>(null)

  // Load the pickable regions once; auto-select when there's only one (the Tahoe-launch case).
  useEffect(() => {
    let cancelled = false
    listRegions()
      .then((rs) => {
        if (cancelled) return
        setRegions(rs)
        if (rs.length === 1) setRegionId(rs[0]!.id)
      })
      .catch(() => {
        if (!cancelled) setRegionsError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load the chosen region's anchors (resets the picks when the region changes). A 401 here means an
  // anonymous rider hit the account wall — surface the gate, same as propose/create.
  useEffect(() => {
    if (!regionId) return
    let cancelled = false
    setAnchors(null)
    setAnchorsError(false)
    setStart(null)
    setEnd(null)
    setMid(null)
    listAnchors(regionId)
      .then((a) => {
        if (!cancelled) setAnchors(a)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
        else setAnchorsError(true)
      })
    return () => {
      cancelled = true
    }
  }, [regionId])

  const doPropose = useCallback(async () => {
    if (!start) return
    if (loop ? !mid : !end) return
    setError(null)
    setNeedsAccount(false)
    setPhase('proposing')
    try {
      // A loop is end===start with one `via` midpoint (a real out-and-back); one-way is start→end.
      const req = loop
        ? { start: idOf(start), end: idOf(start), via: [idOf(mid!)] }
        : { start: idOf(start), end: idOf(end!) }
      const p = await proposeDrive(req)
      setProposal(p)
      idempotencyKeyRef.current = null // fresh proposal = a new logical create; key is minted on confirm
      setPhase('confirm')
    } catch (e) {
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      else setError(errorMessage(e, voice_create.proposeFail))
      setPhase('form')
    }
  }, [start, end, mid, loop])

  const doCreate = useCallback(async () => {
    if (!proposal) return
    if (creatingRef.current) return // a double-tap must not double-POST /drives (double-charge). (audit #4)
    creatingRef.current = true
    // Mint the key once for this logical create; a sequential retry (below) reuses it so the server
    // dedupes a create whose first attempt may have committed but whose response was lost.
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = uuidV4()
    setError(null)
    setPhase('generating')
    try {
      const m = await createDrive({
        // ⚠ The IDS the proposal echoed, not its resolved endpoints — re-sending a name+coord would
        // reopen exactly the hole the id-only wire closes, and the server would reject it anyway.
        start: proposal.startId,
        end: proposal.endId,
        ...(proposal.via && proposal.via.length ? { via: proposal.via } : {}),
        idempotencyKey: idempotencyKeyRef.current,
      })
      if (m.driveId) {
        // Land on the fresh drive's DETAIL page (its native mini-preview) — NOT straight into a player.
        // The old auto-drop into the couch "simulated drive" felt abrupt; the rider now arrives at their
        // drive and chooses: tap a stop to hear it, or Start the live drive. `replace` (not push) so Back
        // returns to home, not the spent create flow (the credit is already gone). (docs/decisions/
        // detail-page-mini-preview.md)
        router.replace({ pathname: '/drives/[id]', params: { id: m.driveId } })
      } else {
        setError(voice_create.generateFail)
        setPhase('confirm')
      }
    } catch (e) {
      if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
      // 403 = the free-drive cap (the server message names the limit + the credit-pack path).
      else if (e instanceof ApiError && e.status === 403) setError(e.message)
      else setError(errorMessage(e, voice_create.generateFail))
      setPhase('confirm')
    } finally {
      // Clear on every exit — a FAILED create returns to confirm, where a sequential retry is allowed
      // (the guard only blocks a CONCURRENT double-tap); a success has already navigated away.
      creatingRef.current = false
    }
  }, [proposal, router])

  // Anchors filtered by the picker search (case-insensitive substring). FEATURED (the curated popular
  // subset) float to the top, then A→Z for browsability — the short curated list is mostly tapping.
  const filtered = useMemo(() => {
    const all = anchors ?? []
    const q = query.trim().toLowerCase()
    const list = q ? all.filter((a) => a.name.toLowerCase().includes(q)) : all
    return [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name))
  }, [anchors, query])

  const choose = (a: RegionAnchor) => {
    if (picking === 'start') setStart(a)
    else if (picking === 'end') setEnd(a)
    else if (picking === 'mid') setMid(a)
    setPicking(null)
    setQuery('')
  }

  if (needsAccount)
    return (
      <AccountGate
        note={voice_create.gateNote}
        secondaryAction={{ label: 'Not now', onPress: () => setNeedsAccount(false) }}
      />
    )

  if (regionsError)
    return (
      <StateView
        title="Create a Drive"
        message={voice_create.regionsFail}
        tone="danger"
        action={{ label: 'Back', onPress: () => router.back() }}
      />
    )

  if (phase === 'proposing' || phase === 'generating')
    return (
      <>
        <Stack.Screen options={{ title: 'Create a Drive', gestureEnabled: false }} />
        <Thinking lines={phase === 'proposing' ? PROPOSING_LINES : GENERATING_LINES} />
      </>
    )

  if (phase === 'confirm' && proposal) {
    const min = Math.round(proposal.durationSeconds / 60)
    // No stories along the route → block generation (the server also 422s, but don't let the rider
    // spend a credit on an unplayable drive). estStopCount runs the REAL selection in propose.
    const noStories = proposal.estStopCount === 0
    // A loop echoes back `via` (end === start); mark the start + each midpoint instead of start→end.
    // ⚠ `via` is now ANCHOR IDS (the shape POST /drives must re-send); `viaResolved` carries the same
    // midpoints with name+coords for DISPLAY. Rendering off `via` would print a uuid at a rider.
    const isLoop = !!(proposal.via && proposal.via.length)
    const viaShown = proposal.viaResolved ?? []
    const endpoints: DriveMapStop[] = isLoop
      ? [
          { seq: 0, name: cleanPlaceName(proposal.start.name), lat: proposal.start.lat, lng: proposal.start.lng, state: 'upcoming' },
          ...viaShown.map((v, i) => ({
            seq: i + 1,
            name: cleanPlaceName(v.name),
            lat: v.lat,
            lng: v.lng,
            state: 'active' as const,
          })),
        ]
      : [
          { seq: 0, name: cleanPlaceName(proposal.start.name), lat: proposal.start.lat, lng: proposal.start.lng, state: 'upcoming' },
          { seq: 1, name: cleanPlaceName(proposal.end.name), lat: proposal.end.lat, lng: proposal.end.lng, state: 'active' },
        ]
    return (
      <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
        <Stack.Screen options={{ title: 'Does this look right?' }} />
        <View style={[styles.mapFrame, { borderColor: theme.colors.rule }]}>
          <DriveMap polyline={proposal.polyline} stops={endpoints} progress={mapProgress} hideRecenter />
        </View>

        <View style={styles.routeLine}>
          {isLoop ? (
            <>
              <Text variant="title" color="ink">
                Round trip from {cleanPlaceName(proposal.start.name)}
              </Text>
              <View style={styles.arrowRow}>
                <Icon name="car" size={14} color="inkFaint" />
                <Text variant="dim" color="inkFaint">
                  via {viaShown[0] ? cleanPlaceName(viaShown[0].name) : 'a scenic detour'}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text variant="title" color="ink">
                {cleanPlaceName(proposal.start.name)}
              </Text>
              <View style={styles.arrowRow}>
                <Icon name="car" size={14} color="inkFaint" />
                <Text variant="dim" color="inkFaint">
                  the scenic way
                </Text>
              </View>
              <Text variant="title" color="ink">
                {cleanPlaceName(proposal.end.name)}
              </Text>
            </>
          )}
        </View>

        <View style={styles.statRow}>
          <Badge tone="amber" label={`${min} MIN`} />
          {proposal.estStopCount != null ? (
            <Badge tone="pine" label={`${proposal.estStopCount} ${proposal.estStopCount === 1 ? 'STORY' : 'STORIES'}`} />
          ) : null}
        </View>

        {error ? (
          <Text variant="dim" color="danger">
            {error}
          </Text>
        ) : null}

        {noStories && !error ? (
          <Text variant="dim" color="inkFaint">
            No stories along that route yet — try a longer trip, or different start and end points.
          </Text>
        ) : null}

        <View style={styles.ctaGroup}>
          <Button icon="car" title="Make this drive" onPress={() => void doCreate()} disabled={noStories} />
          <Button variant="ghost" title="Adjust the route" fullWidth={false} onPress={() => setPhase('form')} />
        </View>
      </Screen>
    )
  }

  // ANCHOR PICKER (overlay): search + a scroll list of the region's real places. Tap to choose.
  if (picking) {
    return (
      <Screen padded edges={['bottom']}>
        <Stack.Screen
          options={{ title: picking === 'start' ? 'Set the start' : picking === 'mid' ? 'Set the midpoint' : 'Set the destination' }}
        />
        <View style={styles.pickerHead}>
          <Input
            autoFocus
            placeholder="Search places"
            value={query}
            onChangeText={setQuery}
            style={styles.search}
            accessibilityLabel="Search places"
          />
          <Pressable
            onPress={() => {
              setPicking(null)
              setQuery('')
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text variant="body" color="accent">
              Cancel
            </Text>
          </Pressable>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(a) => `${a.name}:${a.lat.toFixed(5)},${a.lng.toFixed(5)}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={() => <Divider />}
          ListEmptyComponent={
            <Text variant="dim" color="inkFaint" style={styles.pickerEmpty}>
              {/* An empty CORPUS (region has zero curated places) reads differently than a search
                  no-match — don't let "No matching places" imply the rider's query is wrong. (Defensive:
                  a disabled field normally blocks opening the picker on an empty corpus.) */}
              {anchors && anchors.length === 0 ? voice_create.emptyCorpus : voice_create.noMatch}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => choose(item)}
              style={styles.anchorRow}
              accessibilityRole="button"
              accessibilityLabel={cleanPlaceName(item.name)}
            >
              <View style={styles.anchorName}>
                <Text variant="body" color="ink">
                  {cleanPlaceName(item.name)}
                </Text>
                {item.featured ? <Badge tone="amber" label="POPULAR" /> : null}
              </View>
              {item.kind ? (
                <Text variant="dim" color="inkFaint">
                  {item.kind}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      </Screen>
    )
  }

  // FORM (default): region (auto/selectable) + a one-way/round-trip toggle + the pickers.
  // `[]` is TRUTHY, so guard on LENGTH: a loaded-but-empty corpus — an un-curated region, the DEFAULT
  // at launch until the paid Places curation runs — is NOT ready. Keep the pickers disabled and show the
  // empty-corpus hint below, distinct from the load-FAILURE (`anchorsError`) and the still-loading (null)
  // cases. Without this, `[]` reads as ready → pickers enabled → the rider dead-ends on "No matching places".
  const anchorsReady = !!anchors && anchors.length > 0
  const emptyCorpus = anchors !== null && anchors.length === 0
  const sameEndpoints = !loop && samePlace(start, end)
  const ready = loop ? !!(start && mid) : !!(start && end) && !sameEndpoints
  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: 'Create a Drive' }} />

      {/* Region — auto-selected when there's only one; selectable chips when there are more. */}
      {regions && regions.length > 1 ? (
        <View style={styles.regionRow}>
          <Text variant="label" color="inkFaint">
            REGION
          </Text>
          <View style={styles.chips}>
            {regions.map((r) => (
              <FilterChip
                key={r.id}
                label={r.displayName}
                active={regionId === r.id}
                onPress={() => setRegionId(r.id)}
                accessibilityLabel={`Region: ${r.displayName}`}
              />
            ))}
          </View>
        </View>
      ) : regions && regions.length === 1 ? (
        <Text variant="label" color="inkFaint">
          {regions[0]!.displayName.toUpperCase()}
        </Text>
      ) : null}

      <Text variant="title" color="ink">
        Where to?
      </Text>

      {/* One-way vs round trip. A round trip routes start → midpoint → start (a bare start==end is a
          degenerate zero-distance route), so loop mode swaps the END picker for a MIDPOINT picker. */}
      <View style={styles.chips}>
        <FilterChip label="One way" active={!loop} onPress={() => setLoop(false)} accessibilityLabel="One way" />
        <FilterChip label="Round trip" active={loop} onPress={() => setLoop(true)} accessibilityLabel="Round trip" />
      </View>

      <PickerField
        label="START"
        value={start ? cleanPlaceName(start.name) : null}
        placeholder="Choose a start"
        onPress={() => {
          setQuery('')
          setPicking('start')
        }}
        disabled={!anchorsReady}
      />
      {loop ? (
        <PickerField
          label="MIDPOINT"
          value={mid ? cleanPlaceName(mid.name) : null}
          placeholder="Choose a turnaround point"
          onPress={() => {
            setQuery('')
            setPicking('mid')
          }}
          disabled={!anchorsReady}
        />
      ) : (
        <PickerField
          label="END"
          value={end ? cleanPlaceName(end.name) : null}
          placeholder="Choose where to end"
          onPress={() => {
            setQuery('')
            setPicking('end')
          }}
          disabled={!anchorsReady}
        />
      )}

      {sameEndpoints ? (
        <Text variant="dim" color="inkFaint">
          Same start and end? Switch to Round trip and pick a midpoint.
        </Text>
      ) : null}
      {emptyCorpus ? (
        <Text variant="dim" color="inkFaint">
          {voice_create.emptyCorpus}
        </Text>
      ) : null}
      {anchorsError ? (
        <Text variant="dim" color="danger">
          {voice_create.anchorsFail}
        </Text>
      ) : null}
      {error ? (
        <Text variant="dim" color="danger">
          {error}
        </Text>
      ) : null}

      <Button title="Plan the drive" onPress={() => void doPropose()} disabled={!ready} />
    </Screen>
  )
}

// A tappable FROM/TO field: a label + the picked place (or a placeholder) + a chevron, opening the
// anchor picker. Looks like an Input but is a button (the value is chosen, never typed).
function PickerField({
  label,
  value,
  placeholder,
  onPress,
  disabled,
}: {
  label: string
  value: string | null
  placeholder: string
  onPress: () => void
  disabled?: boolean
}) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
      style={[
        styles.field,
        { borderColor: theme.colors.rule, backgroundColor: theme.colors.surfaceRaised, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <View style={styles.fieldText}>
        <Text variant="label" color="inkFaint">
          {label}
        </Text>
        <Text variant="body" color={value ? 'ink' : 'inkFaint'}>
          {value ?? placeholder}
        </Text>
      </View>
      <Icon name="expand" size={16} color="inkFaint" />
    </Pressable>
  )
}

// The persona "thinking" beat — a centered spinner with a cycling skipper line.
function Thinking({ lines }: { lines: string[] }) {
  const theme = useTheme()
  const [i, setI] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setI((n) => (n + 1) % lines.length), 1800)
    return () => clearInterval(iv)
  }, [lines.length])
  return (
    <Screen padded contentContainerStyle={styles.thinking}>
      <ActivityIndicator size="large" color={theme.colors.accent} />
      <Text variant="body" color="inkDim" align="center">
        {lines[i]}
      </Text>
    </Screen>
  )
}

// Local copy for this screen (kept terse + warm). Lives here rather than the shared `voice` until
// the Create flow's wording settles.
const voice_create = {
  proposeFail: "Couldn't plot that route. Try a different start or end.",
  generateFail: 'The skipper hit a snag building that drive. Give it another go.',
  regionsFail: "Couldn't load the regions. Check your connection and try again.",
  anchorsFail: "Couldn't load places for this region. Check your connection and try again.",
  gateNote: 'Create a free account to plan your own drives.',
  // A region whose curated Places feed hasn't been filled yet (the DEFAULT until the paid curation run).
  // NOT an error and NOT a search miss — warm "coming soon", so the rider knows it's us, not them.
  emptyCorpus: 'No curated stops in this region yet — check back soon.',
  noMatch: 'No matching places.',
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  regionRow: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // FROM/TO picker fields
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 60,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: border.hair,
  },
  fieldText: { flex: 1, gap: space.xs },
  // Anchor picker overlay
  pickerHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  search: { flex: 1 },
  anchorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingVertical: space.md },
  anchorName: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  pickerEmpty: { paddingVertical: space.lg },
  // Confirm
  mapFrame: { height: 240, borderRadius: radius.lg, borderWidth: border.hair, overflow: 'hidden' },
  routeLine: { gap: space.xs },
  arrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ctaGroup: { gap: space.sm, marginTop: space.sm },
  thinking: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
})
