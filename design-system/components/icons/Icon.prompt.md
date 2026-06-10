Semantic vector icon — the Ionicons set the Skipper app ships, tinted with a theme color role. Use it anywhere you'd reach for a glyph; never use emoji.

```jsx
<Icon name="car" size={20} color="amberToken" />
<Icon name="scenic" color="water" />
```

The host page must load the Ionicons web component once:
`<script type="module" src="https://cdn.jsdelivr.net/npm/ionicons@7.4.0/dist/ionicons/ionicons.esm.js"></script>`

Names are semantic (`story`, `scenic`, `break`, `play`, `forward15`, `passed`, `downloaded`, `settings`…), so call sites read by intent and the whole set can be re-skinned in one place. Decorative by default — the surrounding control carries the accessible label.
