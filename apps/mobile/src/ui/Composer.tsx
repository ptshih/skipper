// The planner composer — the rider's half of the conversation (1.1 step 7). A growing multiline
// field plus one enamel send disc, sized for a thumb in a parked car.
//
// PRESENTATION ONLY. It does not know what a turn costs, whether one is in flight (the screen's
// TypingDots says that), or that a cap exists. It reports two things: the text changed, and the
// rider pressed send.
//
// ⚠ There is deliberately NO `maxLength`. The transcript/turn caps live in ONE home,
// apps/api/src/limits.ts, and a too-long turn already comes back gracefully and IN PERSONA (the
// server wraps up rather than erroring). A client-side limit would be a second copy of a number the
// client is never told — exactly the drift the one-home rule exists to prevent — and it would
// silently truncate a rider mid-sentence with no explanation.
//
// ⚠ Return is NOT wired to send. On a multiline field the return key is how you write a second
// sentence; hijacking it costs the rider their paragraph and there is nowhere to put a newline.
// Sending is the disc, and only the disc.
import { memo, useCallback, useState, type Ref } from 'react'
import { PixelRatio, Pressable, StyleSheet, View, type TextInput } from 'react-native'
import { hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import { Icon } from './Icon'
import { Input } from './Input'
import { voice } from './voice'

// How tall the field may grow before it scrolls internally — about five body lines plus Input's
// own vertical padding. Five is enough for the longest ask a rider actually types ("Tahoe City
// down to Emerald Bay and back, about three hours, and I'd like to stop for coffee") while
// leaving the transcript the rest of the screen. A raw pixel local, like TransportBar's disc
// sizes: it is a layout dimension, and there is no height scale to reach for.
// ⚠ APPROXIMATE ON PURPOSE — it is NOT typeScale.body.lineHeight × 5. Input deliberately drops
// body's explicit lineHeight (an explicit one clips descenders on iOS), so the rendered line box
// is the font's natural metrics, which are tighter. Treat this as "roughly five lines".
// ⚠ It is "five lines" only at 1×, so it is SCALED, never used raw: the planner is a scrollable
// non-driving surface, which DESIGN §8 leaves UNCAPPED — the accessibility text sizes are a
// supported configuration here, not an edge case. Left fixed, a rider at AX sizes composes their
// sentence through a one-line slot in a box built for five. Multiplying by the font scale is the
// move §8 already cites for the stop list's STOP_ROW_HEIGHT scroll target.
const FIELD_MAX_HEIGHT = 144

export interface ComposerProps {
  /** The rider pressed send, with what they had typed.
   *
   *  ⚠ THE DRAFT IS THIS COMPONENT'S OWN STATE, and that is a PERFORMANCE contract, not a style
   *  preference. Held at the screen root, every character re-ran HomeScreen's ~500-line body on the
   *  character-appears latency path — measured at exactly one full screen render per keystroke, which
   *  reconciles the whole transcript and the route card's native MapView. Keeping it here means a
   *  keystroke re-renders this row and nothing else. Do not lift it back up for the convenience of a
   *  caller that wants to read the draft; give the caller a ref or a callback instead.
   *
   *  The screen therefore never sees the text until send, and the field is cleared HERE. */
  onSend: (text: string) => void
  /** A turn is in flight. Disables send so one rider tap can't bill two Opus calls. */
  sending?: boolean
  placeholder: string
  /** The screen focuses the field after "Adjust the route" and "Start fresh" — the only two
   *  moments a keyboard is wanted. Never on mount: a keyboard on cold start covers the hero,
   *  the example asks and MY DRIVES, which is everything a first-timer needs to orient. */
  inputRef?: Ref<TextInput>
  /** Focus edges, so the screen can FREEZE the rotating placeholder while the rider is deciding what
   *  to type. ⚠ On focus, not on the first keystroke: text changing under someone mid-thought is the
   *  distraction the rotation has to avoid, and they are thinking before they type. */
  onFocus?: () => void
  onBlur?: () => void
}

function ComposerBase({
  onSend,
  sending = false,
  placeholder,
  inputRef,
  onFocus,
  onBlur,
}: ComposerProps) {
  const { colors } = useTheme()
  const [text, setText] = useState('')
  // Shape, not a cap: an empty turn is nothing to say. The server drops blank turns anyway, so
  // this only spares the rider a paid round-trip that answers nothing.
  const canSend = text.trim() !== '' && !sending

  // ⚠ CLEARED HERE, and the screen has no way to clear it. The two reset paths do it by UNMOUNTING
  // this component instead: "Start fresh" renders the wrap-up bar in place of the composer, and the
  // region switch remounts it via a `key` keyed on the conversation counter. That is deliberate — a
  // `clear()` handle would be a second way to empty the field, and the first one already exists.
  const send = useCallback(() => {
    const t = text.trim()
    if (t === '' || sending) return
    onSend(t)
    setText('')
  }, [onSend, sending, text])

  return (
    <View style={styles.row}>
      <Input
        ref={inputRef}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        accessibilityLabel={voice.plan.composerA11yLabel}
        onFocus={onFocus}
        onBlur={onBlur}
        // The field grows with what's typed (intrinsic content height) until FIELD_MAX_HEIGHT,
        // then scrolls inside itself — no onContentSizeChange bookkeeping.
        multiline
        // RN 0.86 TextInput docs, `multiline`: it "aligns the text to the top on iOS, and centers
        // it on Android. Use with textAlignVertical set to top for the same behavior in both."
        // Without it, Android floats the first line in the middle of a half-empty growing box.
        textAlignVertical="top"
        // No `submitBehavior`, no `onSubmitEditing`. Per those same docs, a multiline input already
        // defaults to 'newline' when submitBehavior is undefined — which is the behavior we want and
        // the reason this is a comment rather than a prop.
        returnKeyType="default"
        // Read per render, not at module scope: a StyleSheet is evaluated once at import and
        // would freeze the scale the app happened to launch with.
        style={[styles.field, { maxHeight: FIELD_MAX_HEIGHT * PixelRatio.getFontScale() }]}
      />
      {/* An enamel disc, not a labeled Button: the row is already the rider's sentence, and a
          60pt CTA next to a growing field would own a screen that belongs to the conversation.
          GLOW-LESS — the screen's one amber is spent elsewhere (DESIGN §8). */}
      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel={voice.plan.sendA11yLabel}
        accessibilityState={{ disabled: !canSend, busy: sending }}
        style={({ pressed }) => [
          styles.send,
          { backgroundColor: colors.primaryFill },
          pressed && styles.pressed,
          !canSend && styles.disabled,
        ]}
      >
        <Icon name="send" size={22} color="onPrimary" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  // Bottom-aligned: as the field grows upward the disc stays on the last line, where the thumb
  // already is. Centering it would make the send target wander up the screen mid-sentence.
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  field: { flex: 1 }, // maxHeight rides on the element — it scales with Dynamic Type
  send: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
})

/** ⚠ MEMOIZED, and the reason is the audio tick rather than typing. Typing already costs the screen
 *  nothing (the draft lives in here), but `useRoutePreview` re-renders HomeScreen twice a second for
 *  as long as a preview clip plays — which re-rendered this whole row, TextInput included, 2×/sec
 *  underneath a rider who may be mid-sentence. Nothing here depends on playback.
 *
 *  ⚠ SO THE CALLER MUST PASS STABLE CALLBACKS. `onFocus`/`onBlur` in particular were inline arrows at
 *  the call site; left that way they defeat this comparator completely and it silently does nothing. */
export const Composer = memo(ComposerBase)
