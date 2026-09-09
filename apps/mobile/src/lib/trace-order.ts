/** Existing trace filenames put the drive ID before the date, so whole-name sorting groups by
 * drive. Compare the ISO-shaped timestamp without reading every GPS recording into memory. */
export function newestTraceFirst(a: { name: string }, b: { name: string }): number {
  const stamp = (name: string) =>
    /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/.exec(name)?.[1] ?? ''
  return stamp(b.name).localeCompare(stamp(a.name)) || b.name.localeCompare(a.name)
}
