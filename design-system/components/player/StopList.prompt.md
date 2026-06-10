The route itinerary — one raised card of hairline-ruled stop rows. The same component on the tour-detail screen (all rows upcoming) and inside the drive player (rows carry live active/passed state).

```jsx
<StopList
  title="THE ROUTE · 10 STOPS"
  items={stops.map(s => ({ seq: s.seq, name: s.name, sublabel: 'Scenic', icon: 'scenic', state: s.state }))}
  onPressItem={jumpTo}   // preview only
/>
```

Pass `scroll` to make it a fixed shell whose rows scroll inside (the player dock); default sizes to its content (tour detail, host page scrolls).
