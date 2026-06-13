import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Catalyst-style soft badges: a low-opacity tinted fill with colored text (not solid fills).
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-zinc-500/15 text-zinc-700 dark:bg-white/10 dark:text-zinc-200',
        secondary: 'bg-zinc-500/10 text-zinc-600 dark:bg-white/5 dark:text-zinc-400',
        destructive: 'bg-red-500/15 text-red-700 dark:bg-red-500/15 dark:text-red-400',
        outline: 'text-foreground ring-1 ring-inset ring-border',
        success: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
        warning: 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
        info: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
