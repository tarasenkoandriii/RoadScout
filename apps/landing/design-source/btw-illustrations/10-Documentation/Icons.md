# Icons — `05-Icons/`

## Purpose

A production icon system covering the whole interface — not four icons,
76 assets across 9 families, built so the interface, landing page, and
presentation materials can all be assembled from one shared set.

## Sizes

Every flat icon ships as **one** source SVG (`viewBox="0 0 24 24"`, no
hard-coded pixel identity beyond a 24px default). Recommended render sizes
— **16, 20, 24, 32, 48, 64, 96, 128** — are all the *same file*, sized via
CSS/attributes, not 8 separate pre-baked files per icon. See
`05-Icons/README.md`'s "Sizes" section for why 76×8=608 static files was
deliberately not produced.

## Structure

```
05-Icons/
├── core/            4 icons  — open, point, detect, warning
├── camera/          10 icons — camera type/status
├── detection/       10 icons — vehicles, pedestrian, incident
├── navigation/       9 icons — routing, position, orientation
├── privacy/           7 icons — data-handling states
├── status/            8 icons — generic UI state
├── ui/                12 icons — chrome and controls
├── hero/              10 assets — reusable illustration components (not flat icons)
├── brand/              6 assets — logo, favicon, platform icon exports
├── sprites/           sprite.svg, sprite-symbol.svg
├── previews/          contact-sheet.svg, icons-light.png, icons-dark.png
├── manifest/
│   ├── icons.json
│   └── categories.json
├── docs/              README.md, Naming.md, DesignRules.md, Usage.md
└── svgo.config.json
```

**76 total** (60 flat icons + 10 hero-family + 6 brand), not the ~74
originally estimated — the UI category has 12 icons (not 11) and Brand has
6 (not 5) once every explicitly-named file is counted.

## Components / families

Two color models coexist:

- **`currentColor` (default)** — nearly every flat icon has no baked-in
  color; the consuming app sets `color` via CSS and the icon follows.
- **Semantic (fixed)** — a handful of status/badge icons bake in a real
  token color because the color *is* the message (`status/success.svg`,
  `camera/camera-online.svg`, etc.) — see `05-Icons/docs/DesignRules.md`.

## Variants: the sprite system

`sprites/sprite.svg` and `sprites/sprite-symbol.svg` both bundle the same
60 flat icons (not the hero/brand families) as `<symbol>` elements for
`<use>`-based consumption. Symbol IDs are namespaced by category
(`icon-camera-fixed`, `icon-status-warning`) except `core/`, which stays
bare (`icon-open`) — full naming rules in `05-Icons/docs/Naming.md`.

**Compatibility note carried over from that build:** always include both
`href` and `xlink:href` on every `<use>` element — some WebKit-based
renderers only resolve the legacy `xlink:href` form, and a missing one
produces a silently blank icon with no error. This isn't theoretical; it's
the exact failure mode hit and fixed while building this sprite.

## Export

SVGO config at `05-Icons/svgo.config.json` — see `Optimization.md` for the
exact settings and why `removeDimensions` is enabled here but disabled for
the illustration/favicon families.

## Acceptance criteria

- [x] Only the 5(+2) documented tokens appear anywhere (`bg/primary/
      success/warning/neutral`, plus `danger` and `muted` added
      specifically for this family — see `Design-Tokens.md`)
- [x] No `filter`/`<image>`/`<script>` anywhere
- [x] Max `<g>` nesting of 2
- [x] Every icon file well under the 2KB budget (largest is a few hundred
      bytes)
- [x] No duplicate `id`s within any single file, or across the assembled
      sprite

See `05-Icons/docs/README.md`, `Naming.md`, `DesignRules.md`, and
`Usage.md` for the full detailed writeup — that folder has its own
complete documentation set, this file is a summary/index into it.
