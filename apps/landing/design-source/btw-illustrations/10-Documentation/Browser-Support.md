# Browser Support

## Minimum supported

- Chrome (current + previous major version)
- Firefox (current + previous major version)
- Safari (current + previous major version, macOS and iOS)
- Edge (current + previous major version, Chromium-based)

No specific older-browser support (IE11, legacy Edge) is targeted or
tested against. Every SVG feature used across this project — `path`,
`rect`, `circle`, `ellipse`, `line`, `polygon`, `polyline`, `text`, `g`,
`symbol`, `use`, inline `<style>` with `@keyframes`, `transform` — is part
of stable, long-supported SVG 1.1/CSS, so in practice these assets likely
render correctly in much older browsers too; that's just not a target this
project tests for or makes guarantees about.

## `<use>` compatibility note (sprites)

`05-Icons/sprites/sprite.svg` and `sprite-symbol.svg` use `<use>` to
reference `<symbol>` definitions. Modern evergreen browsers resolve
`<use href="#id">` with the plain `href` attribute; some WebKit-based
renderers (older Safari, some embedded/headless WebKit builds) only
resolve the legacy `xlink:href` form and silently render nothing if it's
missing. **Always include both:**

```xml
<svg xmlns:xlink="http://www.w3.org/1999/xlink">
  <use href="#icon-camera-online" xlink:href="#icon-camera-online"/>
</svg>
```

This isn't a theoretical concern — it's the exact failure mode discovered
and fixed while building the icon sprite for this project (a headless
WebKit renderer used during development returned a blank icon with plain
`href` alone, and rendered correctly only once `xlink:href` was added
too).

## CSS animation compatibility

The inline `<style>`/`@keyframes` animations used in Hero, Privacy, and
Open Graph's default/light variants (FOV cone opacity pulse, phone
breathing scale) rely on standard CSS animation properties applied to SVG
elements via `transform-box: fill-box` (needed so a `scale()` transform's
origin is the element's own bounding box, not the SVG viewport's origin) —
supported in every browser in the minimum-support list above. Raster
exports (PNG/WebP/JPG) necessarily capture one static frame and never
animate, regardless of browser — that's a property of raster formats, not
a compatibility gap.

## Rendering engine used during development

Renders produced *while building* these assets (for internal pixel-level
validation, not for shipping) used a headless WebKit engine
(`wkhtmltoimage`, Qt WebKit-based). Two quirks specific to that renderer,
not to browsers generally, are documented where relevant so they aren't
mistaken for a general compatibility concern:

- It always composites SVG transparency onto an opaque page background
  with no transparent-output mode (worked around via chroma-key extraction
  for the favicon's exports — see `Export-Guide.md`).
- It doesn't reliably honor very small `--width`/`--height` render
  requests (worked around by rendering large and downsampling).

Neither of these is a real browser's behavior — actual Chrome/Firefox/
Safari/Edge all support transparent SVG rendering and accurate arbitrary
render sizes normally. They're artifacts of the specific offline rendering
tool used for internal QA during this project's development, called out
here so a future contributor using a *different* renderer doesn't assume
these workarounds are still necessary.

## Testing checklist

Before shipping a change to any SVG in this project, confirm it still
renders correctly in at least:

- [ ] Chrome (desktop)
- [ ] Firefox (desktop)
- [ ] Safari (desktop or iOS)
- [ ] Edge (desktop)

See `Validation.md` for the full pre-ship checklist this is one part of.
