The signature Trailhead 89 motif — a dashed atlas trail with the car token gliding along it. Drive it with a `progress` value in [0,1].

```jsx
<RouteTrack progress={0.38} />
<RouteTrack progress={0.06} glow={false} />  {/* parked, no halo */}
```

The token is the skipper's rig (not a generic dot) and wears the amber halo by default. Pass `glow={false}` whenever a NOW card or CTA already owns the screen's single amber glow.
