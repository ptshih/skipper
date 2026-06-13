import * as React from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// A text Input with a leading search icon. `wrapperClassName` controls width/flex of the field.
export const SearchInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }
>(({ wrapperClassName, className, ...props }, ref) => (
  <div className={cn('relative', wrapperClassName)}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input ref={ref} className={cn('pl-9', className)} {...props} />
  </div>
))
SearchInput.displayName = 'SearchInput'
