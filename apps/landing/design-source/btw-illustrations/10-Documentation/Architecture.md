# Architecture

## Shape of the system

This is not one design system with one master file — it's **five sibling
asset families** (Hero, Privacy, Icons, Open Graph, Favicon), each with its
own master SVG(s), each independently exportable, all drawing from **one
shared token set** (`manifest/tokens.json`) and **one shared set of
conventions** (grid, stroke rules, required/forbidden SVG features). There
is no single "app shell" that imports all of them — each asset family is
consumed independently by whatever part of the product needs it (the
landing page imports Hero, the app's privacy screen imports Privacy, the
`<head>` imports Favicon and Open Graph, and UI chrome imports Icons).

```
                    manifest/tokens.json
                    (colors, grid, stroke, radius)
                            │
        ┌───────────┬───────┼───────┬───────────┐
        ▼           ▼       ▼       ▼           ▼
    04-Hero     06-Privacy 05-Icons 07-OpenGraph 08-Favicon
   (1200x900)   (800x400)  (24x24)  (1200x630)   (512x512)
        │           │                    │           │
        └─────┬─────┴──────────┬─────────┘           │
              ▼                ▼                     │
      shared component     shared component           │
      geometry: Phone,     geometry: Route,           │
      ScanCone,            Compass, GPS               │
      CameraMarker,                                    │
      CameraFOV                                        │
                                                         ▼
                                                 05-Icons/brand
                                                 (Logo mark, reused
                                                  at every scale)
```

## Dependency direction: geometry, not files

No asset family imports another family's `.svg` file via `<use
href="../other-folder/File.svg">` — that would create real path
dependencies between folders that break the moment either folder moves.
Instead, dependencies are **geometric/conventional**: a later asset re-derives
the same shape, proportions, and token usage as an earlier one, documented
explicitly rather than silently copied.

Concretely:

- `06-Privacy-Illustration`'s Phone (180×340) and `04-Hero-Illustration`'s
  Phone (160×320) are two *different* files with two *different* sizes,
  because the two illustrations are drawn at different scales — but they
  share the same corner radius (24), same screen inset (~12-14px), same
  stroke width (4/2), and the same "status dot + faint scan-lines" screen
  treatment. Compare them side by side in `Components.md`.
- `07-OpenGraph/master/og-image.svg` reuses the *aiming formula* from
  `04-Hero-Illustration`'s `CameraFOV.svg` (generalizing "aim straight up"
  into "aim at an arbitrary target point"), not the file itself — because
  the OG composition needs three cameras aimed from different positions at
  one shared point, which the original component's fixed "up" convention
  doesn't support. See `07-OpenGraph/manifest/og.json → reuseComponents`
  for the full per-component trace.
- `08-Favicon/master/favicon.svg` rescales `05-Icons/brand/logo-mark.svg`'s
  shield+wedge+dot shape from a 64-unit box up to a 512-unit one, replacing
  its stroke-based outline with solid fills (see `Favicon.md` for why).

This means: if you're changing a shape that's conceptually shared (say, the
phone silhouette), you are **not** editing one file that propagates
everywhere — you're deciding, file by file, whether each dependent asset
should follow the change. That's a deliberate tradeoff: more files to touch
per change, in exchange for zero risk of one illustration's edit silently
breaking a completely different composition at a different scale that
happens to reuse the same file.

## Known gaps in the shared component library

Two components appear in this project's specifications repeatedly but
don't yet have a single, standalone, reusable file anywhere:

- **Warning** — drawn inline in both `06-Privacy-Illustration/privacy.svg`
  and `07-OpenGraph/master/og-image.svg`, with matching (but not
  file-shared) geometry: a triangle + exclamation mark, `stroke-width`
  ~2.4–2.6, neutral color.
- Everything else on the "12 required components" list (`Components.md`)
  does have at least one real file to point to.

If a sixth asset family needs Warning, promoting it to a real
`components/Warning.svg` (living wherever makes sense once there's a
second real consumer beyond Privacy/OG) is a small, well-scoped task — see
`Components.md`'s Warning entry for the exact path data to start from.

## Asset Generation Pipeline

*(This section is the project's Appendix C, "Asset Generation Pipeline" —
folded in here because it's fundamentally an architectural concern: how a
manifest becomes a shipped set of files.)*

Every asset in this repository was produced by the same conceptual
pipeline, whether or not a literal `pipeline/` directory of scripts exists
yet (it doesn't — see the note at the end of this section):

```
pipeline/
├── validate     — check the JSON manifest against the common schema
├── generate     — compute exact geometry, emit the master SVG(s)
├── optimize     — run SVGO, verify size budgets
├── export       — rasterize to PNG / WebP / JPG / ICO as needed
├── preview      — render light/dark/social/thumbnail previews
├── test         — pixel-level bounding-box checks per element (see below)
└── publish      — copy into the shipped folder structure
```

### Stages, in the order they actually run

1. **Validate the JSON Manifest.** Confirm `viewBox`, `components`,
   `tokens` reference real, existing things before generating anything
   from them.
2. **Validate Design Tokens.** Confirm every color the manifest's asset is
   about to use exists in `manifest/tokens.json` — catches a typo'd hex
   value before it ever reaches an SVG file.
3. **Generate the master SVG.** Computed, not hand-drawn — every
   illustration in this project (Hero, Privacy, OG, Favicon) was built by a
   small Python script computing angles/arcs/positions from named
   parameters (origin, radius, angle), not by typing path coordinates
   directly. This is what makes "the cone extends past the phone by
   exactly this much" a reproducible calculation instead of a guess.
4. **Optimize with SVGO.** See `Optimization.md` for the exact config and
   why certain default optimizations (`removeDimensions`) are disabled for
   illustration/favicon files but fine for flat icons.
5. **Export** to whatever raster formats the asset's manifest calls for.
6. **Generate previews** — light/dark/social/thumbnail, depending on the
   asset (see `09-Previews/`).
7. **Visual regression** — re-render and compare element-by-element
   bounding boxes against expected positions. This is how three real bugs
   were caught during this project's own build: a flipped connector arrow,
   a 30px misalignment, and a 3-level group nesting violation — none of
   which were visible from reading the SVG source, all of which were
   obvious once rendered and measured.
8. **Publish** — copy into the folder structure this repository actually
   ships (`0N-AssetName/...`).

### Automatic checks run somewhere in that pipeline

- JSON Schema validation (manifest structure)
- SVG well-formedness (valid XML)
- File size limits (per `Performance.md`)
- Color palette validation (only tokens from `Design-Tokens.md` appear)
- Duplicate ID detection
- Safe-area validation (content doesn't cross the documented margin)
- Browser compatibility (only features listed in `Browser-Support.md`)
- Pixel-perfect comparison (rendered output matches expected element
  positions within tolerance)

### What actually exists today vs. what this describes

There is no single `pipeline/` script or CI job in this repository yet that
runs all seven stages automatically end-to-end. What exists is the
*practice*: every asset family was built using generator scripts specific
to that family (not committed to this repository — they're development
tooling, not shipped assets) that followed exactly this validate → generate
→ optimize → export → preview → test sequence, with the "test" step done
via rendered pixel-bounding-box checks rather than a formal visual-regression
harness. Building a literal `pipeline/` directory that runs all of this
automatically from a manifest, for any future asset, is real, well-scoped
future work — not something this documentation pass invents evidence for
just because the brief describes it.
