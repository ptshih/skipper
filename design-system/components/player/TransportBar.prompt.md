The player transport. Two modes:

```jsx
{/* ready / done: a single CTA + optional ghost */}
<TransportBar single={{ icon: 'play', title: "Let's roll", onPress: start }} />

{/* driving: the icon-forward row */}
<TransportBar playing onPlayPause={toggle} onSeekBack={back15} onSeekForward={fwd15} canSeek
  secondary={{ title: 'Pull over', onPress: end }} />
```

The center play/pause is a glow-less enamel disc; the lit NOW card or the gliding token owns the screen's single amber glow.
