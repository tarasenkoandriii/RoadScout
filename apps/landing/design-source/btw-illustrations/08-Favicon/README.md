# Favicon — v1.0.0

Single master SVG (`master/favicon.svg`, 512×512), every other file in this
folder exported from it. Same shield mark as `05-Icons/brand/logo-mark.svg`,
rescaled and simplified for legibility down to 16px.

## Files

```
master/
  favicon.svg              512x512 — single source of truth
exports/
  favicon-16.png            16x16
  favicon-32.png             32x32
  favicon-48.png             48x48
  favicon.ico          16/32/48 bundled in one .ico
  apple-touch-icon.png     180x180  (solid bg, no transparency)
  android-chrome-192.png   192x192
  android-chrome-512.png   512x512
  mask-icon.svg            512x512  (pure black silhouette)
  safari-pinned-tab.svg    512x512  (identical to mask-icon.svg)
manifest/
  favicon.json
README.md
```

## Design

Three solid shapes, no strokes, no text, one shared center:

- **Shield** — the primary silhouette (`#3B82F6`), the same shape used
  everywhere else in the project as the brand mark.
- **Wedge** — a solid notch (`#0F172A`) echoing the scan-cone motif from
  `04-Hero-Illustration`.
- **Dot** — a solid accent (`#F8FAFC`), the "lens" — same role as the status
  dot on the phone's screen in the hero illustration.

Three colors total, at the brief's limit.

### Why solid fills instead of stroked lines

The brief requires a 4px minimum line weight, checked at every exported
size down to 16px. Working backward from a 512-unit master, a stroke that
still reads as ≥4px once scaled down to a 16px render needs to be about
**128 units thick** in the source — on a mark whose shield is only ~305
units wide, a stroke that heavy starts to swallow the shape's interior
entirely. Rather than fight that math, this mark uses solid fills for
everything: a filled region can't "thin out" and disappear the way a stroke
can, so the 4px rule is satisfied by construction rather than by hitting an
exact number. See `manifest/favicon.json → designRules.minLineWeightNote`.

### What actually survives at 16px

At 16×16, the shield's silhouette is crisp and immediately readable — that's
the part carrying the "is this the right icon" recognition job, and it holds
up fine. The wedge and dot shrink to only a couple of pixels each and read as
a subtle darker/lighter fleck inside the shield rather than a distinct shape
— which is normal for a design with secondary internal detail at this size,
not a bug. Both accents are clearly legible again from 32px up (see the
pixel maps below). If a future favicon needs the wedge+dot to stay crisp
even at 16px, that's a different, bolder design than "shrink the same mark
uniformly" — flag it if that's actually needed.

**16×16** (ASCII map, P=shield, N=dot, B=wedge, o=antialiased edge):
```
.....PPPPPP.....
...PPPPPPPPPP...
...PPPPOOPPPP...
...PPPPNNPPPP...
...PPPPOOPPPP...
...PPPPBBPPPP...
...PPPOOOOPPP...
...PPPPPPPPPP...
```

**32×32** — same mark, wedge and dot both read clearly:
```
.......PPPPPPPPPPPPPPPPPP.......
......PPPPPPPPoNNoPPPPPPPP......
......PPPPPPPPNNNNPPPPPPPP......
......PPPPPPPPPooPPPPPPPPP......
......PPPPPPPPoBBoPPPPPPPP......
......PPPPPPPoBBBBoPPPPPPP......
......PPPPPPPBBBBBBPPPPPPP......
```

## Transparency

Every export is transparent-background **except** `apple-touch-icon.png`,
which ships on a solid `#0F172A` fill with no rounding baked in — this
matches Apple's own guidance (iOS composites transparency to black if you
don't provide a background, and applies its own corner-radius mask on top
of whatever you give it, so pre-rounding it yourself double-rounds the
icon). Same decision already documented for `05-Icons/brand/apple-touch-icon.svg`.

`mask-icon.svg` and `safari-pinned-tab.svg` are pure `#000000`, no
background at all — Safari recolors the whole shape via the `color`
attribute on `<link rel="mask-icon">`, so any color or background baked
into the file itself would be ignored or would break the mask.

## How the exports were actually produced

The renderer available in this environment (`wkhtmltoimage`) always
composites onto an opaque page background and has no transparent-output
mode. True alpha was recovered by rendering the master once against a
`#FF00FF` background — a color nowhere near any of this mark's three colors
— then converting each pixel's distance from that exact magenta into an
alpha value (fully magenta → transparent, fully non-magenta → opaque,
smoothly graded in between for anti-aliased edges). All raster sizes were
then produced by Lanczos-downsampling that one clean 512×512 RGBA source,
not by re-rendering the SVG at each target size — that keeps every export
consistent with a single source of truth, per the brief's requirement that
generation happen only from the master SVG.

## Manifest

`manifest/favicon.json` follows the common schema shared across the
project's asset manifests (`id/version/viewBox/components/exports/tokens/
license`), with favicon-specific fields (`designRules`, `geometry`,
`sizes`) layered on top. `tokens` points at the centralized `tokens.json`
(see the top-level `manifest/` folder).
