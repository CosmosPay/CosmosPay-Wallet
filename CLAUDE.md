# CosmosPay Wallet — working agreement

## Styling: no inline styles, ever

**The `style` attribute is banned in every `.tsx` and `.astro` file.** All styling
lives in `.css` files under `src/styles/`. There are no exceptions — not for
state-driven values, not for per-item computed values, not for CSS custom
properties, not for a one-line tweak.

Components must not accept or forward a `style` prop either. Expose `className`
and let the caller compose a class.

```tsx
// NO
<div className="home-asset-row" style={{ animationDelay: `${i * 0.05}s` }} />
<button style={on ? { background: 'var(--surface)' } : undefined} />

// YES
<div className="home-asset-row" />
<button className={on ? 'network-dd-item is-on' : 'network-dd-item'} />
```

### Where a rule goes

Neither `.astro` page carries a `<style>` block; both import stylesheets in
cascade order. `src/styles/` mirrors `src/components/`:

- `src/styles/theme.css` — design tokens only (`--bg`, `--glass-bg`, `--frame-max`)
- `src/styles/base.css` — element resets: `html/body`, form controls, scrollbars
- `src/styles/animations.css` — every `@keyframes`, the press/hover rules, the
  `.stagger-*` ladder, and the reduced-motion block (which must stay last)
- `src/styles/app.css` — utility atoms (`.row`, `.col`, `.g8`, `.f1`, `.min0`,
  `.glass`, `.btn-primary`, `.input`, `.spinner`)
- `src/styles/components/<name>.css` — one sheet per component
- `src/styles/screens/<area>/<name>.css` — one sheet per screen
- `src/styles/approve.css` — document chrome for the approval window only

Each sheet opens with a header comment naming the `.tsx` it dresses. Prefer
composing the existing atoms over redeclaring metrics: a full-width pill button is
`className="btn-primary"`, not a fresh 54px/999px rule.

### How to express what used to be inline

| Was inline | Now |
| --- | --- |
| `style={{ background: on ? X : 'transparent' }}` | `.is-on` modifier class |
| `style={{ transform: open ? 'rotate(180deg)' : 'none' }}` | `.is-open` modifier class |
| `style={{ flex: 1 }}` | the existing `.f1` atom |
| `style={{ marginBottom: err ? '8px' : '16px' }}` | `.has-err` modifier class |
| `align === 'right' ? { right: 0 } : { left: 0 }` | `.is-right` / `.is-left` |
| per-index `animationDelay` | `:nth-child()` in the sheet — drop the prop |
| index-driven position | `:nth-child()` / sibling combinators |
| content-sized `width: Nch` | a fixed width in the sheet |

Staggered list entrances use the fixed ladder in `animations.css`. Call
`staggerClass(index, dense)` from `src/constants/parts.ts`; it clamps to
`STAGGER_STEPS`, so rows past the cap share the last delay instead of taking a
computed value. `:nth-child()` is deliberately NOT used — the rows have
non-row siblings (section headers), so positional selectors would miscount.

```tsx
<div className={`tap home-asset-row ${staggerClass(index)}`} />
```

Sizes and colours that arrive as props follow the same rule: enumerate the
supported values as classes and type the prop to that union, so an unsupported
value is a compile error rather than a silent missing style. `TokenAvatarSize`
and `SpinnerTone` are the worked examples.

Modifier classes are `.is-*` / `.has-*` and are always written alongside the base
class, never alone. When a modifier has to beat a utility (`.glass`'s animation,
`.glass-soft`'s border), use a compound selector — `.glass.confirm-sign-card` —
so it wins regardless of bundle order instead of reaching for `!important`.

### No JS-side style objects

`src/constants/ui.ts` used to export `C`, `CONTROL`, `CONTROL_H` and `inputStyle`
as `CSSProperties` objects to spread into `style`. It has been deleted. Colours and
metrics belong in CSS: `.glass` / `.glass-soft` / `.glass-bright` / `.input` /
`.btn-primary` are the class equivalents, and `src/styles/theme.css` is the single
source of truth for colour. Do not reintroduce a TS module of style values — a
constant holding a colour string can only ever be consumed inline.

## Writing CSS here

Ship both the prefixed and unprefixed form of a property when Safari still needs
the prefix (`backdrop-filter`, `user-select`); write them out yourself rather than
trusting the bundler to add them. The CSS minifier is pinned to esbuild in
`astro.config.ts` precisely because the default one deletes declarations — see the
comment there before changing `cssMinify` or `cssTarget`.

The app is a phone-shaped column that also runs as an MV3 popup, a side panel, a
Capacitor WebView and a web page, so viewport-relative heights go through
`--shell-h` and safe-area padding through `env(safe-area-inset-*)`. `npm run
test:responsive` guards the column across 320px → 1920px.
