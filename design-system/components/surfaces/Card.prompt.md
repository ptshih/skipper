The ranger placard — the workhorse surface. Plain by default (kept glanceable for the car); `framed` adds a carved double-keyline + corner screw-dots for non-driving surfaces (the home hero, detail headers, empty states).

```jsx
<Card><Text variant="title">The North Shore Drive</Text></Card>
<Card framed>…hero content…</Card>
<Card active onPress={select}>…selected row…</Card>
```

Props: `framed`, `active` (selected — pine keyline), `onPress` (makes it tappable).
