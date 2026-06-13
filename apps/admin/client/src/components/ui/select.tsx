import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// A lean native <select> styled in the shadcn idiom — enough for the admin's few dropdowns
// without the full radix Select tree. The native chevron is hidden (appearance-none) and a
// ChevronDown is drawn at a controlled inset so it doesn't float far from the value (and so it
// renders identically across browsers + themes). `className` sizes the wrapper (e.g. `w-auto`);
// it defaults to full width, so form selects fill their field. Swap in @radix-ui/react-select
// later if richer menus (search, groups) are wanted.
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className={cn('relative inline-flex w-full', className)}>
      <select
        ref={ref}
        className="h-9 w-full appearance-none rounded-md border border-input bg-transparent py-1 pl-3 pr-8 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
)
Select.displayName = 'Select'

export { Select }
