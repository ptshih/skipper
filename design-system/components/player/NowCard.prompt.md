The player card — the one elevated, glowing surface that holds now-playing content, an optional scrubber, and the transport as a single unit. Composes Text, Badge, Scrubber, and TransportBar.

```jsx
<NowCard
  kicker="NOW PLAYING · STORY"
  title="Emerald Bay Overlook"
  glow
  right={<Badge tone="pine" label="Story" />}
  transport={<TransportBar playing onPlayPause={toggle} canSeek onSeekBack={b} onSeekForward={f} />}
>
  <Scrubber positionMs={pos} durationMs={dur} onSeek={seek} />
</NowCard>
```

`glow` is the campfire halo — light it only while a clip actively plays (one amber glow per screen). Paused / rolling / ready / done sit flat.
