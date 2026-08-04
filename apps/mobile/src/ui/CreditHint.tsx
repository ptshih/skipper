// The gentle "N free drives left" line, and the rule for when it appears at all.
//
// ⚠ ONE component because it was TWO copies — home's offline branch and MY DRIVES each carried the
// threshold, the `remaining <= threshold` test AND the sentence, and the comment beside one of them
// already said the other "must not keep a copy — one home, or the two drift silently and nothing
// fails". Both said 5, so nothing was visibly wrong yet; that is precisely the state the saved-drive
// card was in before one surface got a fix the other never did. The doctrine this satisfies is
// root CLAUDE.md's "count, authorise and ACT from ONE expression".
import type { DriveList } from '@/lib/api'
import { Text } from './Text'
import { voice } from './voice'

/** The balance exactly as the drives list reports it. Derived from the wire DTO rather than
 *  re-declared, because a hand-copied shape is the same bug this file exists to end. */
type Credits = NonNullable<DriveList['credits']>

/**
 * Show the hint only at or below this balance.
 *
 * Not derived from the server's grant amount on purpose: the rider's grant is FROZEN at signup while
 * the server default moves, so a ratio ("show under 10%") would mean different things to two riders on
 * the same screen. An absolute count is the thing a rider can act on — it answers "should I be
 * careful?", which a percentage of a number they never saw does not.
 *
 * Deliberately SILENT until the balance is actually low: with a generous allotment an always-on
 * counter hangs a meter on a charm-first screen to report a wall roughly a decade away. It reappears
 * with enough runway to matter, which is the only moment it informs anything.
 */
const CREDIT_HINT_THRESHOLD = 5

export interface CreditHintProps {
  /** `null` = hidden, and there are only two ways to get there: no account (no gated call is made at
   *  all) or a server old enough to predate the field. There is no uncapped case to hide for —
   *  premium is credits, not a plan. */
  credits: Credits | null
}

/**
 * Whether the hint will render anything — for a caller that must decide something ELSE from the same
 * fact (MY DRIVES omits its whole list header when neither this nor the dead-zone note applies, since
 * an empty header would still take the list's row gap and hang a band of air above the first card).
 *
 * ⚠ EXPORTED so that decision reads the SAME expression this component acts on. A caller re-deriving
 * `remaining <= 5` is how the rule got written twice in the first place; `<CreditHint>` itself is
 * defined in terms of this, so the two can never disagree.
 */
export function hasCreditHint(credits: Credits | null): boolean {
  return !!credits && credits.remaining <= CREDIT_HINT_THRESHOLD
}

export function CreditHint({ credits }: CreditHintProps) {
  if (!hasCreditHint(credits) || !credits) return null
  return (
    <Text variant="label" color="inkFaint">
      {voice.credits.left(credits.remaining)}
    </Text>
  )
}
