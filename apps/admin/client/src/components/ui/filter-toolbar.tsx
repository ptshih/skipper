import type { ReactNode } from 'react'
import { SearchInput } from '@/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// A filter dropdown with a leading "all" sentinel option + the scoped options — wraps the
// <SelectTrigger><SelectValue/></SelectTrigger> + "All …" boilerplate every filter Select re-typed.
export function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  allLabel: string
  options: { value: string; label: ReactNode }[]
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// The standard list filter bar: a search field (canonical width) + filter dropdowns (passed as
// children, typically <FilterSelect>s) + a right-aligned "{shown} of {total}" result count.
export function FilterToolbar({
  search,
  onSearch,
  searchPlaceholder,
  shown,
  total,
  children,
}: {
  search: string
  onSearch: (v: string) => void
  searchPlaceholder?: string
  shown: number
  total: number
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        wrapperClassName="min-w-[16rem] max-w-sm flex-1"
        placeholder={searchPlaceholder}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      {children}
      {/* tabular-nums so the count doesn't reflow the bar as digits change under a keystroke. */}
      <span className="ml-auto text-sm text-muted-foreground tabular-nums">
        {shown} of {total}
      </span>
    </div>
  )
}
