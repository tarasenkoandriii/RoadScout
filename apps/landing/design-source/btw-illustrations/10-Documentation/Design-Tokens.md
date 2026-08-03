# Design Tokens

Full definitions live in `manifest/tokens.json` (the consolidated,
project-wide version) and originally in
`02-Foundation/tokens/design-tokens.json` (the founding set, still
authoritative for `grid`/`stroke`/`radius`). This document explains what
each token means and which asset families actually use it — not every
family uses every token, and that's deliberate, not an inconsistency.

## Colors

| Token | Hex | Role | Used by |
|---|---|---|---|
| `bg` | `#0F172A` | dark canvas background | all illustration families |
| `primary` | `#3B82F6` | accent, active/scanning state | all families |
| `success` | `#22C55E` | positive/verified/online state | all families |
| `warning` | `#EAB308` | caution accent (yellow) | Hero, Icons, OpenGraph — **not** Privacy |
| `danger` | `#EF4444` | prohibition/error state (red) | Icons, Privacy — added when Icons was built, since neither the original Hero spec nor its palette ever needed an error state |
| `neutral` | `#F8FAFC` | primary stroke/ink on dark bg; or bg on light variants | all families |
| `muted` | `#64748B` | de-emphasized/disabled state | Icons only |

**Why `warning` is missing from Privacy:** that illustration's own brief
specifies exactly 5 colors and lists them explicitly — `warning` isn't one
of them. This wasn't an omission introduced during development; it's what
the brief's own palette section says, and the finished asset honors that
exactly (no yellow appears anywhere in `06-Privacy-Illustration`).

**Why `danger` and `muted` didn't exist in the original token set:** the
founding Hero specification never needed an error state or a de-emphasized
one — it only had success/active/caution states. Both were added
specifically when the icon system (`05-Icons`) was built, since icons like
`status/error.svg` and disabled UI states genuinely needed them, and
`danger` was subsequently reused by Privacy (the "no video upload" slash).

## Grid

| Context | Unit |
|---|---|
| Illustrations (Hero/Privacy/OpenGraph) | 8px |
| Icons | 24px canvas |
| Favicon | 512px canvas, 12% safe area |

See `Design-System.md` for why these three don't share one grid.

## Stroke widths

| Context | Default | Fine detail |
|---|---|---|
| Illustrations | 4 | 2 |
| Icons | 2 | 1.5 |
| Favicon | — (solid fills only, no strokes) | — |

## Radii

`sm: 8`, `md: 16`, `lg: 24` — one shared set, used at both illustration and
icon scale (illustration phone corners use `lg`; icon badge corners use
values from the same set, proportioned to the smaller canvas).

## Opacity

No single shared "opacity scale" exists across every family — each
composition defines its own opacity values for its own layered effects,
documented per-file:

| Use | Typical value | Where |
|---|---|---|
| Scan-cone outer layer | 0.30 | Hero, OpenGraph |
| Scan-cone inner/glow layer | 0.15–0.16 | Hero, OpenGraph |
| Camera FOV cone | 0.14–0.30 (animated pulse range) | Hero, Privacy, OpenGraph |
| Camera pulse ring | 0.15 | Hero |
| Screen scan-lines | 0.30–0.35 | Hero, Privacy Phone components |
| Cloud (external/distant surface) | 0.55 | Privacy |
| Skyline silhouette | 0.06 | Hero |
| Logo mark's scan-wedge | 0.28 | Brand/Logo |

## Typography

Used only by Open Graph (the one asset family with real text content) and
the Logo wordmark:

| Role | Size | Weight |
|---|---|---|
| Logo/wordmark | 44–64px (font-size varies with canvas scale) | 700 (bold) |
| Title | 52px | 700 |
| Subtitle | 26px | 400 |
| Tagline | 20px | 400 |

Max 2 font weights per composition (bold for logo/title, regular for
subtitle/tagline) — never introduce a third weight without updating this
table and the reasoning behind the 2-weight rule (simplicity, fast
legibility in a 1-2 second glance).

## States

Where a component represents a state rather than a fixed object, the
state's color is what encodes it — never a separate shape or icon swap:

| State | Token | Example |
|---|---|---|
| Online/reachable | `success` | `camera/camera-online.svg` dot badge |
| Ambiguous/edge case | `warning` | CameraMarker's `warning` color option |
| Recording | `danger` | `camera/camera-record.svg` dot badge |
| Prohibited/blocked | `danger` | Privacy's "no video upload" slash |
| Verified/protected | `success` | Shield component |
| Disabled/inactive | `muted` | Icons only — `status/offline.svg`'s ring |
