# Getting Started

## Installation

There's nothing to install to *use* this repository — it's a static asset
library. Clone or unzip it, and every `.svg`/`.png`/`.webp`/`.jpg`/`.ico`/
`.json` file is immediately usable as-is.

To *build/optimize* assets, you'll want:

```bash
npm install -g svgo   # or: npx svgo, no global install needed
```

Nothing else is required. There is no Node build step, no bundler config,
and no package.json anywhere in this repository — every asset is a
hand-authored (or script-generated, see `Architecture.md`) static file.

## Repository structure

See `README.md` for the full top-level layout. Inside each numbered asset
folder, the internal shape is consistent:

```
0N-AssetName/
├── (master SVG(s), at the folder's top level or under master/)
├── components/          reusable sub-pieces specific to this asset (where applicable)
├── exports/              rasterized formats, when the asset needs them
├── manifest/
│   └── <asset>.json      the detailed manifest for this asset
└── README.md              the detailed doc for this asset (what this
                             documentation folder's per-asset .md file summarizes/points to)
```

Not every folder has every one of those — `05-Icons` has no single master
SVG (it's 76 independent ones) and instead has `sprites/` and `previews/`;
`08-Favicon` has `master/` instead of a bare top-level file. Check each
folder's own `README.md` for its exact shape — this is the general pattern,
not a strict template every folder was forced into.

## Rules for creating a new SVG

1. **Pick the right grid.** Illustrations (hero-scale scenes) use an 8px
   grid; icons use a 24px grid; the favicon uses a 512px canvas with a 12%
   safe area. See `Design-System.md`.
2. **Use only the shared tokens.** Colors, stroke widths, and radii all
   come from `Design-Tokens.md` — never introduce a new hex value or a
   stroke width that isn't already in the token set without updating the
   tokens first (and documenting why).
3. **Required attributes, every time:** `viewBox`, `width`, `height`,
   `role="img"`, `aria-hidden="true"` (or a real `aria-label`/`title` if
   the SVG is ever used non-decoratively — see `Accessibility.md`).
4. **Forbidden, every time:** `<filter>`, `<script>`, `<image>` (raster
   images embedded in a vector asset), `<foreignObject>`. See
   `SVG-Rules.md` for why each of these is banned, not just that they are.
5. **Unique `id`s.** No two elements in the same file share an `id`; when a
   file will be assembled into a sprite (see `05-Icons/sprites/`), the `id`
   also needs to stay unique against every *other* file entering that same
   sprite — that's what the sprite build script's namespacing
   (`icon-{category}-{name}`) is for.
6. **Max `<g>` nesting: 2.** A `<g>` inside a `<g>` is fine; a `<g>` inside
   a `<g>` inside a `<g>` is a violation, checked automatically — see
   `Validation.md`. This one is easy to reintroduce by accident when
   grouping elements for a `transform`; double-check after any refactor
   that touches grouping.
7. **Coordinates on the grid.** Illustration anchor points (component
   origins, camera positions, phone corners) should land on multiples of 8
   where the design allows it. Some of this project's own founding
   specification's numbers don't (see `Hero.md`'s note on this) — match the
   *explicit* numbers a brief gives you over the *general* grid rule when
   they conflict, and don't "fix" pre-existing geometry to satisfy the
   grid rule unless asked.
8. **Run it past `Validation.md`'s checklist before calling it done.**

## Process: from a blank file to a shipped asset

1. **Design in a script, not by hand-tweaking coordinates in a text
   editor.** Every asset in this repository past `03-SVG-Component-Library`
   was built by a small Python generator computing exact coordinates
   (angles, arc endpoints, badge positions) rather than eyeballing numbers.
   This matters because these are geometric scenes (cones, fields of view,
   converging lines) where getting an angle or a radius wrong by eye is
   easy and hard to notice without rendering. See `Architecture.md`'s
   pipeline section.
2. **Render and validate before treating anything as final.** Rendering an
   SVG to a raster and checking pixel bounding boxes of each element caught
   several real bugs during this project's own development — a flipped
   arrow direction, a 30px vertical misalignment, a group-nesting
   violation — that were not obvious from reading the SVG source alone.
   Don't skip this step because the markup "looks right."
3. **Export to whatever raster formats the asset needs** — see
   `Export-Guide.md`.
4. **Generate/update the manifest** — see `Manifest.md`.
5. **Update the relevant preview(s)** in `09-Previews/` if the asset has a
   light/dark/social/thumbnail representation there.
6. **Update `Changelog.md`** in this folder with what changed.

## Where design tokens live

The single source of truth for colors/grid/stroke/radius is
`manifest/tokens.json` (the consolidated, project-wide version). Individual
asset folders may reference a subset of it — see `Design-Tokens.md` for the
full picture and `Manifest.md` for how the `tokens` field in each asset
manifest points back to it.
