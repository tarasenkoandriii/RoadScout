# Privacy — `06-Privacy-Illustration/`

## Purpose

The three-message privacy explainer: cameras stay with their owners, video
never leaves the camera or reaches the cloud, and the app works from
geometry and on-device location only. Built as a reusable module (shared
components, not one throwaway picture) so it composes into the landing
page, docs, and presentation decks without redrawing anything.

## Sizes

| Variant | ViewBox | Layout |
|---|---|---|
| `privacy.svg` (master) | 800×400 | horizontal 3-zone (cameras \| phone \| cloud) |
| `privacy-mobile.svg` | 750×1000 | **re-composed** vertical stack |
| `privacy-square.svg` | 700×700 | **re-composed** vertical stack |
| `privacy-dark.svg` | 800×400 | intentionally identical to `privacy.svg` |

## Structure

```
06-Privacy-Illustration/
├── privacy.svg / privacy-mobile.svg / privacy-square.svg / privacy-dark.svg
├── components/     Camera, Phone, Cloud, NoUpload, Shield, Route, GPS, Compass, FOV
├── manifest/
│   └── privacy.json
├── previews/
│   └── privacy-dark.png, privacy-light.png
└── README.md
```

## Components used

Camera (×3, with rightward FOV cones), Phone, GPS, Route, Warning (drawn
inline, see `Components.md`), Compass, Shield, Cloud, NoUpload. Full
parameter reference in `Components.md`.

## Why the mobile/square variants are re-compositions, not crops

The master is a wide horizontal narrative (cameras → phone → cloud, left to
right). Cropping that into a portrait or square frame cuts one of the three
zones off entirely — usually the cameras, since they're at the far left.
Both variants restack the same nine components vertically instead: cameras
on top with their field-of-view rotated to face downward toward the phone,
phone in the middle, cloud at the bottom. Same decision already made for
`04-Hero-Illustration/hero-mobile.svg`.

## `privacy-dark.svg`

Identical to `privacy.svg` — the brief specifies exactly one background
(`#0F172A`, solid) with no second dark palette to diverge from. Shipped as
an honest, explicitly-labeled copy (see the comment at the top of the
file) for pipelines that select assets by a `-dark` filename suffix.

## Two flagged discrepancies from the original brief

1. The brief's prose lists **Warning** among the reusable components but
   its own proposed folder tree lists **`components/FOV.svg`** instead —
   this build follows the folder tree literally: FOV ships as a real file
   (genuinely reused 3× per composition), Warning is drawn inline (used
   once per layout).
2. The color palette section lists exactly 5 tokens
   (`bg/neutral/primary/success/danger`) and **omits** the yellow `warning`
   token — that's the brief's own choice, not an oversight; no yellow
   appears anywhere in this asset family.

## Bugs caught during development (worth knowing before editing geometry)

All three were invisible from reading the SVG source and only became
obvious once rendered and measured pixel-by-pixel:

- A connector arrow (phone → GPS) pointed the wrong direction — the
  direction math assumed left-to-right, but GPS sits to the phone's left.
- That same arrow was vertically misaligned by 30px from the row it was
  supposed to connect to.
- Camera glyphs nested `<g>` three levels deep, violating the project-wide
  max-2 rule.

Takeaway for future edits: render and check element bounding boxes after
any coordinate change, don't trust the markup by inspection alone — see
`Validation.md`.

## Export

All 4 SVG files, no raster export step of their own (previews in
`previews/` are for review, not shipped production assets). Sizes: 5.7–6.2KB
per file, against the ≤8KB budget (`Performance.md`).

## Acceptance criteria

- [x] Only the 5 documented tokens appear anywhere
- [x] No `filter`/`<image>`/`<script>` anywhere
- [x] Max `<g>` nesting of 2 (after the fix above)
- [x] Every file under the 8KB budget
- [x] CSS-only animation (FOV pulse, phone breathing) — no JavaScript; the
      red "no video upload" slash is deliberately excluded from any
      animation, per the brief

See `06-Privacy-Illustration/README.md` for the full detailed writeup.
