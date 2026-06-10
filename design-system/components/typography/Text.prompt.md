The one text primitive — pick a type-scale `variant` and a semantic `color` role. Never inline a font or a hex; everything routes through here.

```jsx
<Text variant="display" color="ink">Hop in. I'll do the talking.</Text>
<Text variant="label" color="accentWarm">Now Departing</Text>
<Text variant="mono" color="inkDim">02:18 / 06:45</Text>
```

Variants: `wordmark` `display` `placardTitle` (Alfa Slab, large only) · `titleXL` `title` `heading` `body` `bodyStrong` `label` `dim` (Bitter) · `mono` `monoStrong` (Space Mono). Colors are any semantic role. Use `as` to emit a real heading/paragraph tag.
