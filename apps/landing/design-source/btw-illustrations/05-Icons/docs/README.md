# BTW Icon Design System — 05-Icons

Production SVG design system for Beyond the Wall. Covers the whole interface —
not just the hero illustration — across 9 asset families.

## What's in here

| Family | Path | Count | Grid |
|---|---|---|---|
| Core Icons | `core/` | 4 | 24×24 |
| Camera Icons | `camera/` | 10 | 24×24 |
| Detection Icons | `detection/` | 10 | 24×24 |
| Navigation Icons | `navigation/` | 9 | 24×24 |
| Privacy Icons | `privacy/` | 7 | 24×24 |
| Status Icons | `status/` | 8 | 24×24 |
| UI Icons | `ui/` | 12 | 24×24 |
| Hero Assets | `hero/` | 10 | component-native |
| Brand Assets | `brand/` | 6 | asset-native |
| **Total** | | **76** | |

(The original brief estimated "~74." Counting every file actually listed in
each family gives 76 — UI has 12 items, not 11, and Brand has 6, not 5. See
`docs/Naming.md` for the exact file-by-file list.)

```
05-Icons/
├── core/            open, point, detect, warning
├── camera/          10 camera type/status icons
├── detection/       10 object-detection icons
├── navigation/       9 routing/positioning icons
├── privacy/          7 data-handling icons
├── status/           8 generic state icons
├── ui/               12 chrome/control icons
├── hero/             10 reusable illustration components
├── brand/             6 logo & platform icon exports
├── sprites/
│   ├── sprite.svg          symbol sprite, 60 flat icons, for <use>
│   └── sprite-symbol.svg   same 60 symbols + <title> per icon (inline use)
├── previews/
│   ├── icons-light.png
│   ├── icons-dark.png
│   └── contact-sheet.svg
├── manifest/
│   ├── icons.json
│   └── categories.json
├── docs/
│   ├── README.md        (this file)
│   ├── Naming.md
│   ├── DesignRules.md
│   └── Usage.md
└── svgo.config.json
```

## Design language in one paragraph

Flat icons (`core/camera/detection/navigation/privacy/status/ui`) are
line-art on a 24×24 grid, 2px stroke, round caps/joins, drawn with
`stroke="currentColor"` and no baked-in fill — so a single file re-colors
and re-sizes anywhere via CSS. A handful of **status-carrying** icons bake
in a fixed semantic color on purpose (success/warning/error badges,
camera-online/record dots) because the color itself is the information.
Hero assets (`hero/`) are a different, larger-scale component family —
the same reusable pieces that compose `04-Hero-Illustration` — and keep
that illustration's explicit-neutral-stroke style rather than
`currentColor`, since they're always drawn on the same dark canvas.
Brand assets (`brand/`) are the one-off exports every platform expects
(favicon, app icon, Apple touch icon, Safari mask icon) built from a single
shield + scan-wedge + dot mark.

## Sizes

Every flat icon ships as **one** source SVG (`viewBox="0 0 24 24"`, no
hard-coded `width`/`height` beyond a 24px default) rather than 8 separate
pre-baked files per icon. Because these are stroke-based vector glyphs,
that single source scales losslessly to any of the recommended sizes —
**16, 20, 24, 32, 48, 64, 96, 128** — via CSS (`width/height`, `font-size`
+ `em`), an HTML `<img>`/`<svg>` size attribute, or the sprite's
`<use width height>`. `manifest/icons.json` lists this size set per icon
so build tooling has a single source of truth. See `docs/Usage.md` for
exactly how to render at each size, and `docs/DesignRules.md` for the one
adjustment worth making at very small sizes (16–20px).

We deliberately did **not** ship 76 × 8 = 608 pre-rendered size variants.
For flat stroke icons that duplication buys nothing (there is no pixel
grid-fitting step the way bitmap font hinting needs it) and only adds
maintenance surface. If a downstream tool genuinely needs static per-size
files (e.g. a design-review deliverable, or feeding a system that can't
scale SVG), regenerate them from these sources with the same script that
produces `previews/` — see `docs/Usage.md`.

## Start here

- New to the system? Read `docs/DesignRules.md`, then `docs/Naming.md`.
- Wiring icons into a codebase? Read `docs/Usage.md`.
- Looking for a specific icon? Open `previews/contact-sheet.svg` or
  `manifest/icons.json`.
