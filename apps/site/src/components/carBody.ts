// The Skipper car silhouette — ONE definition of the brand's signature moving element.
//
// Only the BODY lives here. The WHEELS deliberately differ per callsite and are NOT shared: each set
// punches through to whatever surface sits behind it (CarToken tires read as `--surface` and add a
// hub dot; Medallion sinks into `--surface-sunken`; the Modes art rides on `--surface-raised` at a
// slightly smaller radius). Sharing them would mean a prop per difference — more machinery than the
// duplication costs.
//
// Before this, the same ~230-char bezier was hand-copied into four files, so any tweak to the
// silhouette was four identical edits with three chances to miss one.
export const CAR_BODY_PATH =
  'M4 14 L4 11 Q4 10 5.5 9.8 L10 9.8 L13 5.5 Q13.4 5 14.4 5 L20.5 5 Q21.6 5 22.3 5.8 L25.2 9.8 L30.5 10.4 Q32 10.7 32 12.2 L32 14 Z'
