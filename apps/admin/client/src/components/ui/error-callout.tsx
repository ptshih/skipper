import type { ReactNode } from 'react'
import { CircleX } from 'lucide-react'
import { Callout } from '@/components/ui/callout'
import { errMsg } from '@/lib/format'

// The single error-banner surface. Wraps `Callout variant="error"` + errMsg() so views stop
// hand-rolling the `border-destructive/40 bg-destructive/10 text-destructive` literal (which silently
// drifts from the Callout token recipe on any tweak). Renders nothing when `error` is null.
// `title` adds the bold heading + icon the drawers use ("Run failed", "Cancel failed", …).
export function ErrorCallout({
  error,
  title,
  className,
}: {
  error: unknown
  title?: ReactNode
  className?: string
}) {
  if (error == null) return null
  return (
    <Callout variant="error" className={className}>
      {title ? (
        <>
          <div className="flex items-center gap-1.5 font-medium">
            <CircleX size={15} /> {title}
          </div>
          <div className="mt-1 leading-relaxed">{errMsg(error)}</div>
        </>
      ) : (
        errMsg(error)
      )}
    </Callout>
  )
}
