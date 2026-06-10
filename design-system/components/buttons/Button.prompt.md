The enamel CTA — primary (ranger-green sign by day, campfire-lit amber at dusk, ≥60pt), secondary (outlined placard), or ghost (text link). Use primary for the one main action per screen.

```jsx
<Button title="Start the drive" icon="car" onPress={start} />
<Button variant="secondary" icon="play" title="Take the simulated drive" onPress={preview} />
<Button variant="ghost" title="Back to the trailhead" onPress={back} />
```

Variants: `primary` · `secondary` · `ghost`. Props: `icon` (leading glyph), `loading`, `disabled`, `fullWidth` (default true), `glow` (drop the dusk amber halo with `glow={false}` when another element owns the screen's single glow).
