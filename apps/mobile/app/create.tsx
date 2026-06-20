// Create a Drive (V2) — the rider talks to the skipper in ONE free-text line; the LLM resolves a
// start + end, Google routes it, and we preview the road-snapped route on a map BEFORE spending a
// credit to generate. Four states behind one screen: FORM (region + prompt + suggestions) →
// PROPOSING (persona "thinking") → CONFIRM (map-hero) → GENERATING → the new drive's preview.
//
// The LLM does ONLY endpoint resolution; the route + the (reused roam) narration selection are
// deterministic server-side. Account-gated: the first action (propose) 401s an anonymous rider into
// the AccountGate — the create wall lands here, not at the front door (roam stays open).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import {
  ApiError,
  createDrive,
  errorMessage,
  listRegions,
  proposeDrive,
  type DriveProposal,
  type Region,
} from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { useTheme } from '@/theme'
import { border, radius, space } from '@/theme/tokens'
import { AccountGate, Badge, Button, Card, FilterChip, Icon, Input, Screen, StateView, Text } from '@/ui'
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

// Canned suggested prompts ("OR TRY ONE") — each is just a prompt through the same propose path.
const SUGGESTIONS = ['Emerald Bay loop', 'The whole West Shore', 'Tahoe City to Kings Beach']

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

export default function CreateDriveScreen() {
  const router = useRouter()
  const theme = useTheme()

  const [regions, setRegions] = useState<Region[] | null>(null)
  const [regionsError, setRegionsError] = useState(false)
  const [regionId, setRegionId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')

  const [phase, setPhase] = useState<Phase>('form')
  const [proposal, setProposal] = useState<DriveProposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsAccount, setNeedsAccount] = useState(false)

  // The confirm map's puck sits at the start (static) — DriveMap wants a progress Animated.Value.
  const mapProgress = useRef(new Animated.Value(0)).current

  // Synchronous in-flight guard for the credit-spending create. setPhase('generating') is async, so
  // a fast double-tap on "Make this drive" would fire two POST /drives before React unmounts the
  // confirm view, and the rider over-spends a lifetime free credit. Mirrors home's navigatingRef. (audit #4)
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

  const doPropose = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!regionId || !q) return
      setError(null)
      setNeedsAccount(false)
      setPhase('proposing')
      try {
        const p = await proposeDrive({ regionId, prompt: q })
        setProposal(p)
        idempotencyKeyRef.current = null // fresh proposal = a new logical create; key is minted on confirm
        setPhase('confirm')
      } catch (e) {
        if (e instanceof ApiError && e.needsAccount) setNeedsAccount(true)
        else setError(errorMessage(e, voice_create.proposeFail))
        setPhase('form')
      }
    },
    [regionId],
  )

  const doCreate = useCallback(async () => {
    if (!proposal || !regionId) return
    if (creatingRef.current) return // a double-tap must not double-POST /drives (double-charge). (audit #4)
    creatingRef.current = true
    // Mint the key once for this logical create; a sequential retry (below) reuses it so the server
    // dedupes a create whose first attempt may have committed but whose response was lost.
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = uuidV4()
    setError(null)
    setPhase('generating')
    try {
      const m = await createDrive({
        start: proposal.start,
        end: proposal.end,
        idempotencyKey: idempotencyKeyRef.current,
      })
      if (m.driveId) {
        // Hand the rider straight into the couch preview of their fresh drive (replace, so Back
        // returns to home, not the spent create flow).
        router.replace({ pathname: '/drives/[id]/play', params: { id: m.driveId, mode: 'preview' } })
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
  }, [proposal, regionId, router])

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
    const endpoints: DriveMapStop[] = [
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
          <Button variant="ghost" title="Adjust the start & end" fullWidth={false} onPress={() => setPhase('form')} />
        </View>
      </Screen>
    )
  }

  // FORM (default): region (auto/selectable) + the one conversational prompt + suggestions.
  const ready = !!regionId && prompt.trim().length > 0
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
        Tell the skipper where to go
      </Text>
      <Input
        multiline
        value={prompt}
        onChangeText={setPrompt}
        placeholder="e.g. from the casino district out to Emerald Bay, the scenic way"
        style={styles.promptInput}
        accessibilityLabel="Where to"
      />

      {error ? (
        <Text variant="dim" color="danger">
          {error}
        </Text>
      ) : null}

      <Button title="Plan the drive" onPress={() => void doPropose(prompt)} disabled={!ready} />

      <View style={styles.suggestWrap}>
        <Text variant="label" color="inkFaint">
          OR TRY ONE
        </Text>
        <View style={styles.chips}>
          {SUGGESTIONS.map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={false}
              onPress={() => {
                setPrompt(s)
                void doPropose(s)
              }}
              accessibilityLabel={`Try: ${s}`}
            />
          ))}
        </View>
      </View>
    </Screen>
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
  proposeFail: "Couldn't make sense of that. Try naming where to start and where to end up.",
  generateFail: 'The skipper hit a snag building that drive. Give it another go.',
  regionsFail: "Couldn't load the regions. Check your connection and try again.",
  gateNote: 'Create a free account to plan your own drives.',
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  regionRow: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  promptInput: { minHeight: 104, textAlignVertical: 'top' },
  suggestWrap: { gap: space.sm, marginTop: space.sm },
  // Confirm
  mapFrame: { height: 240, borderRadius: radius.lg, borderWidth: border.hair, overflow: 'hidden' },
  routeLine: { gap: space.xs },
  arrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ctaGroup: { gap: space.sm, marginTop: space.sm },
  thinking: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
})
