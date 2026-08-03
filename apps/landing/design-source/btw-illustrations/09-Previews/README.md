# Previews — v1.0

Centralized preview hub for the whole BTW SVG design system — one place to
look at every asset family without opening five different folders. Nothing
here is a new design; everything is either copied from or rendered from the
canonical source in its own numbered folder (04/05/06/07/08).

## Structure

```
contact-sheet.svg     all 60 flat icons on one sheet (copy of 05-Icons/previews/contact-sheet.svg)
light/                each asset family previewed on/against a light context
  hero.png
  privacy.png
  og.png
  icons.png
  favicon.png
dark/                 each asset family previewed on its own native dark canvas
  hero.png
  privacy.png
  og.png
  icons.png
  favicon.png
social/                the 5 platform mockups from 07-OpenGraph, copied here under
  telegram.png         plain filenames (no "-preview" suffix) for this folder's
  facebook.png         own naming convention
  linkedin.png
  x.png
  discord.png
thumbnails/            uniform 400x300 gallery thumbnails, one per asset family
  hero.png
  privacy.png
  og.png
  icons.png
  favicon.png
README.md
```

## What's actually a copy vs. actually rendered here

The brief specifies `light/` and `dark/` as directories without listing
exact file contents, so here's what was made explicit rather than left
ambiguous:

| File | Source |
|---|---|
| `light/hero.png`, `dark/hero.png` | copied from `04-Hero-Illustration/preview/` |
| `light/privacy.png`, `dark/privacy.png` | copied from `06-Privacy-Illustration/previews/` |
| `dark/og.png` | copied from `07-OpenGraph/exports/png/og-image.png` |
| `light/og.png` | **rendered here** — `07-OpenGraph/master/og-image-light.svg` exists as a source but had never been rasterized anywhere else in the project |
| `light/icons.png`, `dark/icons.png` | copied from `05-Icons/previews/` |
| `light/favicon.png`, `dark/favicon.png` | **composited here** — the favicon master has no background of its own (it's meant to sit transparently in a browser tab), so these two are the favicon mark placed on a flat light (`#F8FAFC`) and dark (`#0F172A`) backdrop respectively, specifically to let you eyeball contrast on both |
| `social/*.png` | copied from `07-OpenGraph/social-previews/*-preview.png`, renamed without the `-preview` suffix to match this folder's own filename convention |
| `thumbnails/*.png` | **generated here** — each asset's dark preview, letterboxed into a uniform 400×300 frame for a consistent gallery grid |
| `contact-sheet.svg` | copied from `05-Icons/previews/contact-sheet.svg` |

## Quality control (per the brief)

- **Readable at 16×16** — check `light/favicon.png` / `dark/favicon.png`
  against `08-Favicon/README.md`'s pixel maps; the shield silhouette is the
  thing that has to survive at that size, and it does. The internal wedge/
  dot detail is intentionally secondary at 16px — see that README for why.
- **Light and dark themes** — every asset family that has both a light and
  dark treatment is represented in both `light/` and `dark/` here, side by
  side, specifically so a light/dark regression is visible without having
  to open five folders and remember what each one looked like.
- **Pixel perfect** — every file here is either a direct copy of an
  already-validated export (see each source folder's own README for how it
  was validated) or a simple composite/letterbox operation on top of one
  (favicon backdrops, thumbnails) — no new artwork was drawn in this folder,
  so there's nothing here that hasn't already passed its own family's
  validation pass.

## Keeping this folder in sync

Nothing in this folder regenerates automatically. If any source asset
changes (a new hero variant, a re-exported OG image, a re-tuned favicon),
the corresponding file(s) here need to be re-copied/re-rendered by hand —
treat a stale preview here as a documentation bug the same way you'd treat
a stale screenshot in a README.
