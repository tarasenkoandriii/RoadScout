# Favicon — `08-Favicon/`

## Purpose

The single browser-tab/homescreen mark for the whole product — one master
SVG, every platform-specific export (browser favicon, Apple touch icon,
Android home-screen icon, Safari pinned tab) derived from it.

## Sizes

| Export | Size |
|---|---|
| `favicon-16.png` | 16×16 |
| `favicon-32.png` | 32×32 |
| `favicon-48.png` | 48×48 |
| `favicon.ico` | 16/32/48 bundled in one file |
| `apple-touch-icon.png` | 180×180 |
| `android-chrome-192.png` | 192×192 |
| `android-chrome-512.png` | 512×512 |
| `master/favicon.svg` | 512×512 |

## Structure

```
08-Favicon/
├── master/
│   └── favicon.svg
├── exports/
│   ├── favicon-16.png / -32.png / -48.png / .ico
│   ├── apple-touch-icon.png
│   ├── android-chrome-192.png / -512.png
│   ├── mask-icon.svg
│   └── safari-pinned-tab.svg
├── manifest/
│   └── favicon.json
└── README.md
```

## Design rules

- Single composition center
- Minimum line weight: 4px (see below for how this is actually satisfied)
- Safe area: 12%
- No text
- Max 3 colors — this mark uses exactly 3: `primary` (shield fill), `bg`
  (wedge notch), `neutral` (center dot)

## Why solid fills instead of stroked lines

Working backward from a 512-unit master, a stroke that still reads as ≥4px
once downscaled to a 16px render needs to be roughly 128 units thick in the
source — on a shield only ~305 units wide, a stroke that heavy would
swallow the shape's interior. This mark uses solid fills for everything
instead: a filled region can't thin out and disappear the way a stroke can,
so the 4px rule is satisfied by construction rather than by hitting an
exact stroke-width number. See `08-Favicon/README.md` for the full
reasoning and pixel-level ASCII maps at both 16px and 32px showing exactly
what survives at each size.

## Components

Not built from the shared `Components.md` component set directly — the
favicon rescales `05-Icons/brand/logo-mark.svg`'s shield+wedge+dot shape,
replacing its stroke-based outline with solid fills for the reasons above.
See `Components.md`'s Logo entry.

## Export pipeline

The renderer available during this build (`wkhtmltoimage`) always
composites onto an opaque page background and has no transparent-output
mode. True alpha was recovered with a chroma-key technique: render once
against a `#FF00FF` background (a color nowhere near this mark's 3 real
colors), then convert each pixel's distance from that exact magenta into an
alpha value. Every raster size was then produced by Lanczos-downsampling
that one clean 512×512 RGBA source — not by re-rendering the SVG at each
target size — keeping every export consistent with a single source of
truth. Full pipeline in `Export-Guide.md` and
`08-Favicon/manifest/favicon.json → exportPipeline`.

`apple-touch-icon.png` is the one export shipped **without** transparency —
solid `#0F172A` background, no pre-baked corner rounding — per Apple's own
guidance (iOS composites transparency to black otherwise, and applies its
own mask on top of whatever background you give it).

`mask-icon.svg` and `safari-pinned-tab.svg` are pure `#000000` silhouettes
with no background at all — Safari recolors the whole shape via the
`color` attribute on `<link rel="mask-icon">`.

## Acceptance criteria

- [x] Single master SVG, all exports derived from it (not independently
      hand-edited)
- [x] Minimum 4px line weight — satisfied by construction (solid fills, no
      thin strokes) rather than by hitting an exact number
- [x] 12% safe area respected
- [x] No text
- [x] Max 3 colors, used: exactly 3
- [x] Every size exported and dimension-verified (16/32/48/180/192/512 +
      the bundled .ico)

See `08-Favicon/README.md` for the full detailed writeup, including the
16px and 32px pixel-legibility maps.
