// Shared state for THE DRIVES location filter. The home screen publishes the regions
// present in the catalog (derived from the loaded tours) and reads the selection; the
// "Where are we headed?" modal (app/regions.tsx) reads those regions and writes the
// selection. A context (mirrors ThemeProvider) so the picked region survives the modal hop
// without threading it back through navigation params.
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { RegionOption } from './regions'

interface DrivesFilterValue {
  regions: RegionOption[]
  setRegions: Dispatch<SetStateAction<RegionOption[]>>
  selectedRegion: string | null
  setSelectedRegion: Dispatch<SetStateAction<string | null>>
}

const DrivesFilterContext = createContext<DrivesFilterValue | null>(null)

export function DrivesFilterProvider({ children }: { children: ReactNode }) {
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const value = useMemo(
    () => ({ regions, setRegions, selectedRegion, setSelectedRegion }),
    // setters are stable useState dispatchers; listed for exhaustive-deps correctness.
    [regions, setRegions, selectedRegion, setSelectedRegion],
  )
  return <DrivesFilterContext.Provider value={value}>{children}</DrivesFilterContext.Provider>
}

export function useDrivesFilter(): DrivesFilterValue {
  const value = useContext(DrivesFilterContext)
  if (!value) throw new Error('useDrivesFilter must be used within a DrivesFilterProvider')
  return value
}
