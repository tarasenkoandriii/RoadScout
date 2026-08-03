# Open Graph — `07-OpenGraph/`

## Purpose

The `og:image`/Twitter Card asset — not a single banner, a small
marketing-asset system on the same components and tokens as Hero and
Privacy. Has to answer three questions in the 1-2 seconds someone spends
on a link preview: what is this, how does it work, why is it safe.

## Sizes

All master variants and all raster exports: **1200×630**, the standard
Open Graph / Twitter Card dimension.

## Structure

```
07-OpenGraph/
├── master/
│   ├── og-image.svg           default, dark bg, full composition
│   ├── og-image-dark.svg      identical to og-image.svg (see below)
│   ├── og-image-light.svg     genuine light-background recolor
│   ├── og-image-no-text.svg   same scene, left-panel text omitted
│   └── og-image-minimal.svg   logo + phone + scan-cone only
├── exports/
│   ├── png/ webp/ jpg/         all rasterized from og-image.svg
├── social-previews/            telegram/linkedin/facebook/x/discord mockups
├── manifest/
│   └── og.json
├── docs/
│   ├── README.md, Usage.md, ExportGuide.md
└── tests/
    └── visual-checklist.md
```

## Components used

Logo (small corner mark, reused from `05-Icons/brand/logo-mark.svg`),
Phone, ScanCone, CameraMarker ×3, CameraFOV ×3 (aimed at the phone from
three different directions — see `Components.md`'s CameraFOV entry on the
generalized aiming formula this needed), Route, Warning (inline), Compass.
No Hand — the brief explicitly excludes it from this composition.

## Layout

45%/55% split (computed against the full 1200 width: 0–540 left panel,
540–1200 right panel), 64px safe-area padding on every edge. Left panel:
logo mark + "BTW", then title/subtitle/tagline — 4 lines maximum. Right
panel: the phone-centered scene described above, with cameras placed in
different directions so their fields of view visibly cross near the
phone.

## Variants, and two things worth knowing before using them

**"Reuse the same Hero, don't redraw"** — the brief says this, but also
describes a scene the actual `hero.svg` doesn't contain (no Hand, cameras
in multiple directions, a Route/Warning/Compass that never appear there).
Resolved as: reuse the *component geometry* (the same Phone/ScanCone/
CameraFOV math as Hero, the same Route/Compass as Privacy), composed fresh
for this specific layout — not literally embedding `hero.svg`. Full
reasoning and per-component source trace in `07-OpenGraph/manifest/og.json
→ reuseComponents`.

**`og-image-dark.svg`** is intentionally identical to `og-image.svg` — same
reasoning as Hero/Privacy's own `-dark` files. **`og-image-light.svg`**,
unlike those, *is* a real distinct recolor: unlike Hero/Privacy (always-dark
in-app illustrations), an OG image is a standalone marketing thumbnail
where a light card is genuinely sometimes wanted. It reuses the same 5
tokens with bg/ink roles swapped — no 6th color introduced.

## Export

`master/og-image.svg` → `exports/png/`, `exports/webp/`, `exports/jpg/`,
all 1200×630. See `Export-Guide.md` (this folder) and
`07-OpenGraph/docs/ExportGuide.md` (the asset-specific version with the
exact pipeline used) for the full process.

## Social previews

`social-previews/*.png` are approximate layout mockups (not live captures)
for a quick crop/contrast/legibility check before shipping — always
confirm with each platform's real debug tool afterward
(`07-OpenGraph/docs/Usage.md` links all of them).

## Acceptance criteria

- [x] Scales without quality loss (source is vector; only the final
      exports are raster)
- [x] Exports correctly to PNG, WebP, and JPEG (all verified 1200×630)
- [x] Reads at Telegram/LinkedIn/Facebook/X preview proportions
      (`social-previews/`)
- [x] Uses shared library components — 7 of 8 traced to a real existing
      file; Warning remains inline-only, flagged, not hidden
- [x] Unified palette/tokens — this is the one asset family that actually
      uses the yellow `warning` token, per its own brief's palette section
- [x] Source SVG size ≤30KB after SVGO — actual size ~3.4KB, comfortably
      under budget before SVGO even runs

See `07-OpenGraph/docs/README.md` for the full detailed writeup.
