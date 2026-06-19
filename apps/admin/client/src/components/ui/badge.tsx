import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Catalyst-style soft badges: a low-opacity tinted fill with colored text (not solid fills).
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-foreground/10 text-foreground',
        secondary: 'bg-zinc-500/10 text-zinc-600 dark:bg-white/5 dark:text-zinc-400',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'text-foreground ring-1 ring-inset ring-border',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        info: 'bg-info/15 text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  // Render as the single child element (e.g. a <button>) so a clickable chip IS the pill,
  // instead of a <button> wrapping a <Badge> (which gives a taller, inconsistent box).
  asChild?: boolean
}

function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : 'div'
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
