# Design Rules — 05-Icons

These rules apply to the flat icon families (`core/camera/detection/
navigation/privacy/status/ui`). `hero/` follows the older
`04-Hero-Illustration` canonical geometry instead (8px grid, explicit
neutral stroke) — see that folder's own `README.md`. `brand/` follows
platform requirements for each export target (noted per-asset below).

## Grid

- Canvas: **24×24** viewBox.
- Safe area: **2px** padding on every side (live drawing area 20×20).
- Prefer coordinates on a half-pixel or whole-pixel grid; icons here are
  small enough that "on-grid" matters less than "visually balanced" —
  when the two disagree, balance wins.

## Stroke

- Default stroke width: **2**. Dense/small icons (e.g. detection vehicles,
  `gps`, `settings`) may drop to **1.5** if 2px starts closing up gaps.
- `stroke-linecap="round"` and `stroke-linejoin="round"` everywhere.
- No `stroke-dasharray` except `navigation/route.svg`, where the dash
  specifically encodes "suggested / not yet taken" — `route-fixed.svg`
  and `route-ai.svg` use a solid stroke for the same path shape precisely
  to contrast with it. Don't introduce dashes elsewhere without a reason
  as clear as that one.

## Color

Two color models coexist on purpose:

1. **`currentColor` (default).** Nearly every icon has no baked-in color —
   `fill="none" stroke="currentColor"`. The consuming app sets `color` (CSS)
   and the icon follows: same file works in a dark sidebar, a light modal,
   a red "destructive" button, etc.
2. **Semantic (fixed).** A small set of icons bake in a real token color
   because the color *is* the message, and letting a parent override it
   would let a real error render as green:
   - `status/success.svg` — success token
   - `status/warning.svg`, `status/error.svg` — warning / danger tokens
   - `camera/camera-online.svg` (success dot), `camera/camera-record.svg`
     (danger dot), `camera/camera-ai.svg` (primary spark)

Tokens (extends `02-Foundation/tokens/design-tokens.json`; the first five
are shared with the hero spec verbatim, `danger` is new and icon-only):

```json
{
  "bg": "#0F172A",
  "primary": "#3B82F6",
  "success": "#22C55E",
  "warning": "#EAB308",
  "danger": "#EF4444",
  "neutral": "#F8FAFC",
  "muted": "#64748B"
}
```

`danger` and `muted` did not exist in the hero spec because the hero
illustration never needed an error state or a de-emphasized/disabled
state. The icon system does, so they were added here rather than
overloading `warning` for two different meanings.

## Structure

- Every file: `viewBox`, `width`, `height`, `role="img"`, `aria-hidden="true"`.
- Max group nesting: 2 (same rule as the hero spec).
- No `filter`, no `<image>`, no `<script>`, anywhere.
- One badge/accent per icon, placed bottom-right (`cx=19, cy=19` in the
  camera family) — consistent corner across the whole camera set so the
  eye learns one place to look for status.

## Family-specific notes

- **Camera family** shares one base glyph (housing + lens + wall mount);
  every variant is the base glyph plus exactly one accent (lock, globe,
  spark, refresh-arrows, slash, colored dot, radar waves, or FOV lines).
  If you add a new camera-* icon, start from the base glyph rather than
  drawing a new camera from scratch — that's what keeps the set feeling
  like one family instead of ten unrelated drawings.
- **Detection family** (vehicles) favors simplified, map-app-style side
  silhouettes over technical accuracy — legibility at 16–24px beats
  realism every time.
- **Status family**: `online`/`offline` are a matched pair (filled dot vs.
  outline-only dot with a slash) and should stay visually paired if either
  is redesigned.

## Brand asset notes

- `favicon.svg` intentionally simplifies `logo-mark.svg` (thicker stroke,
  fewer internal details) — it has to read at 16px.
- `apple-touch-icon.svg` is a full-bleed square with **no** transparency
  and **no** pre-baked corner radius — iOS applies its own mask; baking in
  rounding yourself double-rounds the icon.
- `mask-icon.svg` is pure black (`#000000`), no background — Safari
  recolors it via the `<link rel="mask-icon" color="...">` attribute, and
  any other color or a background rect will be ignored or break the mask.
- `logo.svg` uses an SVG `<text>` element for the wordmark rather than
  converted outlines. That's fine for previewing and for contexts that
  bundle the brand font, but before shipping this in a context that can't
  guarantee the font is installed, convert the text to paths in your
  design tool of choice (Illustrator/Inkscape/Figma: "outline"/"create
  outlines") so the wordmark can't reflow with a fallback font.
