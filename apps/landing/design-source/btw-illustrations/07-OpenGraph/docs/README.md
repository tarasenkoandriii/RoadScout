# Open Graph — v1.0

Not a single banner image — a small marketing-asset system built on the same
components, tokens, and conventions as `04-Hero-Illustration` and
`06-Privacy-Illustration`, sized for `og:image` / Twitter Card use (1200×630).

## The job of this image

It has to answer three questions in the 1–2 seconds someone spends looking at
a link preview, with no time to read:

1. **What is this?** — BTW wordmark + logo mark, title.
2. **How does it work?** — a phone reading camera geometry around it (scan
   cone, camera markers, intersecting fields of view, a route).
3. **Why is it safe?** — the same illustration language as the rest of the
   product (nothing new to parse), reinforced by the subtitle/tagline text.

## Files

```
master/
  og-image.svg          1200x630  default — dark bg, full composition
  og-image-dark.svg     1200x630  identical to og-image.svg (see note below)
  og-image-light.svg    1200x630  genuine light recolor
  og-image-no-text.svg  1200x630  same scene, left-panel text omitted
  og-image-minimal.svg  1200x630  logo + phone + scan-cone only
exports/
  png/og-image.png
  webp/og-image.webp
  jpg/og-image.jpg
social-previews/
  telegram-preview.png
  linkedin-preview.png
  facebook-preview.png
  x-preview.png
  discord-preview.png
manifest/
  og.json
docs/
  README.md   (this file)
  Usage.md
  ExportGuide.md
tests/
  visual-checklist.md
```

## Layout

`viewBox="0 0 1200 630"`, 64px safe-area padding on every edge. Left panel is
45% of the full width (0–540), right panel is the remaining 55% (540–1200) —
the split is computed against the full canvas, not against the safe area.

**Left panel** (`x: 64–540`): logo mark + "BTW" wordmark, then three more
lines — title, subtitle, tagline — four lines total, the maximum the brief
allows.

**Right panel** (`x: 540–1136`): phone (largest object), its own scan-cone
bleeding past its silhouette, three cameras placed in different directions
around it, each camera's field-of-view cone aimed at the phone so the three
translucent cones visibly cross near the center, a route curve passing under
the phone, a warning glyph just ahead of the route's start, and a small
compass accent. No hand, no skyline, no decorative filler — the brief is
explicit that this panel carries no ornament beyond what's functionally
part of the message.

## Two things worth reading before you use this

### "Reuse the same Hero, don't redraw" — what that actually means here

The brief says to reuse the landing page's Hero without redrawing it, but
then describes a right-panel scene the actual `04-Hero-Illustration/hero.svg`
doesn't contain: no Hand, cameras in multiple directions with crossing FOVs,
plus a Route/Warning/Compass that never appear in the landing hero at all.
Taking "reuse, don't redraw" literally (embed hero.svg unchanged) and taking
the scene description literally are incompatible. This build reuses the
**component geometry** — the same Phone, ScanCone, and CameraFOV math as
`04-Hero-Illustration`, the same Route and Compass as
`06-Privacy-Illustration` — composed fresh for this specific 1200×630 layout,
rather than embedding hero.svg wholesale. See `manifest/og.json →
reuseComponents` for exactly which file each piece's geometry traces back to.

### `og-image-dark.svg` is intentionally identical to `og-image.svg`

Same situation as the hero and privacy folders: the brief specifies exactly
one background (`#0F172A`, solid, no gradient) with no second dark palette to
diverge from. `og-image-dark.svg` exists as an honestly-labeled, literal copy
(see the comment at the top of the file) for pipelines that pick assets by a
`-dark` filename suffix. `og-image-light.svg`, unlike the dark one, **is** a
real, distinct recolor — unlike hero/privacy (always-dark in-app
illustrations), an OG image is a standalone marketing thumbnail where
platforms and embedding contexts genuinely do sometimes want a light card, so
that variant was actually designed, not aliased.

### The "Warning" component doesn't have its own file yet

The brief asks for 8 reusable components including `Warning.svg`, but no
folder in the project (`04-Hero-Illustration/components/`,
`06-Privacy-Illustration/components/`, and this folder, which has no
`components/` directory of its own) has ever shipped a standalone Warning
file — it's been drawn inline everywhere it's needed so far. This build
follows that same pattern rather than inventing a new shared-components
location unprompted. If a real standalone `Warning.svg` is wanted, say so —
it's a small, quick addition, but it changes where it should live.

## Tokens

```json
{
  "bg": "#0F172A",
  "primary": "#3B82F6",
  "success": "#22C55E",
  "warning": "#EAB308",
  "neutral": "#F8FAFC"
}
```

Same 5 tokens as `04-Hero-Illustration`. This is the one asset family in the
project that actually uses the yellow `warning` token — the brief's palette
section explicitly lists it (as an accent, not tied to any single glyph),
unlike `06-Privacy-Illustration`, whose brief omitted it. Red is reserved for
prohibition/error per the brief and isn't used anywhere in this composition
since nothing here represents a blocked/forbidden state.

## Compliance

`viewBox`, `width`, `height`, `role="img"`, `aria-hidden="true"` on every
master file. Only the 5 tokens above appear anywhere. No `filter`,
`<image>`, or `<script>`. Max `<g>` nesting is 1 (well under the project's
2-level rule). Source size budget from the brief is ≤30KB after SVGO —
actual size is ~3.4KB before SVGO even runs, so there's no optimization
pass this needed to pass the budget.

See `docs/Usage.md` for how to wire this into `<meta>` tags, and
`docs/ExportGuide.md` for how the raster exports were produced and how to
regenerate them.
