# Naming

Unified naming rules across the whole project. `05-Icons/docs/Naming.md`
covers icon-specific naming (sprite symbol IDs, category prefixes) in more
depth — this document is the project-wide version those rules sit inside.

## Files

- **Illustrations and their variants:** lowercase, kebab-case —
  `hero.svg`, `hero-mobile.svg`, `privacy-square.svg`,
  `og-image-no-text.svg`. Variant suffixes describe *what's different*
  (`-mobile`, `-square`, `-dark`, `-light`, `-no-text`, `-minimal`), never
  a version number or date.
- **Reusable components:** PascalCase — `Phone.svg`, `ScanCone.svg`,
  `CameraMarker.svg`. This is a deliberate, documented exception to the
  kebab-case rule above: it mirrors how these files are imported as React
  components (`<Phone />`, `<ScanCone />`) elsewhere in the product, so the
  filename matches the component name exactly.
- **Flat icons (`05-Icons`):** lowercase, kebab-case, and — with one
  documented exception — never repeat their own category name as a prefix
  inside their own folder (`detection/car.svg`, not
  `detection/detection-car.svg`). The exception: every file in `camera/`
  legitimately starts with `camera-` (`camera-fixed.svg`, `camera-ptz.svg`)
  because that prefix is part of the actual concept, not the folder.
- **No version suffixes or dates in any filename**, ever — versioning
  lives in the manifest's `version` field (`Manifest.md`), not the
  filename.

## Sprite symbol IDs

Namespaced by category to avoid collisions in the assembled sprite
(`icon-camera-fixed`, `icon-status-warning`), except `core/`, which stays
bare (`icon-open`, not `icon-core-open`) since those four names are
guaranteed-unique foundational vocabulary. Full table in
`05-Icons/docs/Naming.md`.

## Element `id`s inside a single SVG

Stable, descriptive, lowercase-with-hyphens: `background`, `phone`,
`screen`, `scan-cone`, `camera-1`, `camera-fov-1`. These IDs are treated as
part of each asset's public contract (a consumer might target
`#scan-cone` with CSS or JS) — don't rename one casually; that's a
`MAJOR` version bump per `Manifest.md`'s SemVer rules if anything external
could be depending on it.

## JSON manifest keys

`camelCase` throughout (`viewBox`, `screenPadding`, `maxGroupNesting`,
`reuseComponents`) — matching typical JSON/JavaScript convention rather
than the `snake_case` sometimes seen in Python-generated JSON, since these
manifests are meant to be consumed directly by web tooling. The one
top-level exception is `id` itself, always lowercase-kebab
(`"id": "og-image"`, not `"id": "ogImage"`) since it doubles as a
filename-safe identifier.

## Design token names

Lowercase, single word where possible (`bg`, `primary`, `success`,
`warning`, `danger`, `neutral`, `muted`) — never abbreviated further
(`primary`, not `prim`) and never restating what they are
(`primaryColor` would be redundant inside a file already called
`tokens.json`).

## Component parameter names

`camelCase`, descriptive over short: `originX`/`originY` rather than
`ox`/`oy`, `screenPadding` rather than `pad`, `startAngle`/`endAngle`
rather than `a1`/`a2`. These names appear in each component's own
documentation comment (see any file in `04-Hero-Illustration/components/`
or `06-Privacy-Illustration/components/` for the pattern) and in
`Components.md`'s reference — keep the two in sync if either changes.
