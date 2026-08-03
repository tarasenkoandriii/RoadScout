# Design System

The visual language shared across every asset family in this project.
Token *values* live in `Design-Tokens.md` / `manifest/tokens.json` — this
document is the *reasoning*: why the grid is what it is, why stroke widths
differ between families, and what "consistent" actually means here given
that Hero/Privacy/OG, Icons, and Favicon are three genuinely different
visual scales.

## Principles

1. **One geometry, computed, not eyeballed.** Every scene in this project
   (a scan-cone, a field of view, a route curve) is defined by a small set
   of named parameters — origin, radius, angle — and generated from those,
   not hand-drawn point by point. This is why a "40° cone" or a "camera
   aimed at the phone" is exact and reproducible rather than approximate.
2. **Flat, not skeuomorphic.** No gradients, no drop shadows, no textures,
   no noise. Depth (where it exists at all — the hero illustration's
   layered scan-cone, for instance) comes from opacity layering of flat
   shapes, never from a gradient or blur.
3. **Color carries meaning, not decoration.** `success`/`warning`/`danger`
   are never used for their own sake — they mark a real state (a camera is
   online, an incident happened, an action is destructive). Where a shape
   just needs *a* color and the color itself doesn't mean anything,
   `neutral` (icons: `currentColor`) is the default.
4. **Solid fills over thin strokes wherever legibility at small size
   matters.** The favicon abandons stroke-based line art entirely in favor
   of solid shapes for exactly this reason — see `Favicon.md`.
5. **Every scene reuses the same core cast.** Phone, cameras, scan-cones,
   and fields of view are the recurring visual vocabulary of this whole
   project (civic-tech camera-awareness app) — new assets should reach for
   these before inventing new iconography for the same concept.

## Grid

Three different grids coexist, because three genuinely different scales of
asset live in this project:

| Context | Grid unit | Used by |
|---|---|---|
| Illustrations (scenes) | 8px | 04-Hero, 06-Privacy, 07-OpenGraph |
| Flat icons | 24px | 05-Icons |
| Favicon | 512 canvas, 12% safe area | 08-Favicon |

**Why not one grid for everything?** An 8px grid makes sense at
illustration scale (canvases hundreds to over a thousand units across); it
would be far too coarse for a 24-unit icon, where a "multiple of 8" leaves
only 3 usable grid points (0, 8, 16, 24) across the entire canvas. Icons
use their own finer 24px-canvas convention instead (matching how most
production icon systems — Material, Feather, Heroicons — work). The
favicon uses neither: it's one fixed 512-unit master canvas with a
percentage-based safe area, because it's a single mark at a single master
size, not a family of same-grid components.

**A known inconsistency, inherited, not introduced:** the original hero
specification's own anchor points (phone `y=420`, scan origin `y=420`,
camera positions like `(610,280)` and `(540,170)`, marker size `28`) are
not all multiples of 8, despite that same specification stating "all
coordinates are multiples of 8." Where a brief gives explicit numbers, this
project follows those numbers exactly rather than "correcting" them to fit
the general grid rule — see `Hero.md` for the specific values and why they
were kept as given.

## Palette

Full definitions in `Design-Tokens.md`. In brief: `bg` (#0F172A, dark
canvas), `primary` (#3B82F6, accent/active), `success` (#22C55E),
`warning` (#EAB308), `danger` (#EF4444), `neutral` (#F8FAFC), `muted`
(#64748B, icons only). Not every family uses every token — see
`manifest/tokens.json → usedBy` for exactly which families use which
colors and why (e.g., Privacy's brief specifies exactly 5 colors and
omits `warning` deliberately; that's the brief's own palette, not an
oversight).

## Radii

`sm: 8`, `md: 16`, `lg: 24` — defined once in
`02-Foundation/tokens/design-tokens.json`, reused at illustration scale
(phone corners use `lg`, screen corners use a value near `md`) and at icon
scale (badge corners, camera housings).

## Stroke widths

| Context | Default | Fine detail |
|---|---|---|
| Illustrations | 4 | 2 (screens, FOV lines) |
| Icons | 2 | 1.5 (dense/small glyphs) |
| Favicon | — | no strokes at all, solid fills only |

Stroke width scales with the canvas it's drawn on — a 4px stroke on an
8px-grid illustration reads the same way a 2px stroke does on a 24-unit
icon; they're not the same physical weight, they're the same *relative*
weight for their own scale.

## Composition rules

- **Single center of composition** for anything mark-like (the brand mark,
  the favicon) — one clear focal point, not a scattered arrangement.
- **Safe areas are respected for content, not for ambient bleed.**
  Decorative/translucent elements (a scan-cone's tip, a FOV cone's outer
  edge) are allowed to cross a safe-area boundary since they're falloff,
  not information; text, logos, and solid markers are not.
- **Max 2 levels of `<g>` nesting**, everywhere, no exceptions — see
  `SVG-Rules.md`.
- **No text inside icons or the favicon.** Text is reserved for
  illustrations that are explicitly typographic (Open Graph's left panel)
  — an icon or favicon that needs a letter to make sense at 16-24px has
  the wrong concept, not a missing font.
- **Reuse the established visual vocabulary before inventing new
  iconography** for the same real-world object — see `Components.md`
  before drawing a new "camera" or "phone" from scratch.
