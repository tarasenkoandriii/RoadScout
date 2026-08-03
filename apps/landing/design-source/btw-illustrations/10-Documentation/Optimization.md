# Optimization

## Order of operations

1. **Clean the SVG.** Remove editor cruft (unused `<defs>`, empty groups,
   redundant precision in coordinates, unnecessary `xmlns:` declarations an
   individual file doesn't actually use) before running any automated
   tool — this is the pass a human (or an agent) does while actually
   authoring the file, catching things a generic optimizer might not know
   are safe to remove (e.g., a commented-out alternate path that's
   intentional documentation, not leftover cruft — SVGO won't know the
   difference, you have to).
2. **Run SVGO.** See the config section below.
3. **Verify size budgets.** Compare the post-SVGO byte count against
   `Performance.md`'s table for that asset family.
4. **Verify compatibility.** Confirm SVGO didn't strip or rewrite anything
   this project actually depends on — see the "what SVGO must not touch"
   list below — and re-render to confirm the visual result is unchanged.

## SVGO configuration

`05-Icons/svgo.config.json` is the reference config for this project.
Key overrides on top of SVGO's `preset-default`:

```json
{
  "name": "preset-default",
  "params": {
    "overrides": {
      "removeViewBox": false,
      "cleanupIds": false,
      "removeUselessDefs": false,
      "removeUnknownsAndDefaults": { "keepAriaAttrs": true, "keepRoleAttr": true },
      "convertPathData": { "floatPrecision": 2 }
    }
  }
}
```

Plus `removeDimensions` (strips explicit `width`/`height`, leaving only
`viewBox` — appropriate for flat icons meant to be CSS-sized) and
`sortAttrs`.

**This config is for the flat icon families specifically
(`05-Icons/core|camera|detection|navigation|privacy|status|ui/`).** Run it
**without** `removeDimensions` for:

- `04-Hero-Illustration`, `06-Privacy-Illustration`, `07-OpenGraph` — these
  need concrete pixel dimensions (they're composed scenes at a fixed
  aspect ratio, not CSS-resizable icons).
- `08-Favicon` — needs concrete dimensions for platform export generation.

```bash
svgo --config 05-Icons/svgo.config.json 05-Icons/camera -o dist/camera
svgo --config 05-Icons/svgo.config.json --disable removeDimensions 04-Hero-Illustration/hero/hero.svg -o dist/hero.svg
```

## What SVGO must not touch

- **`viewBox`** (`removeViewBox: false`) — removing it breaks scaling
  entirely; this is non-negotiable regardless of asset family.
- **Element `id`s** (`cleanupIds: false`) — these are treated as part of
  each asset's public contract (see `Naming.md`); SVGO's default
  `cleanupIds` optimization renames/removes IDs it thinks are unused,
  which would break any external CSS/JS targeting `#scan-cone` or similar,
  and would break every sprite symbol reference in `05-Icons/sprites/`.
- **`role`/`aria-*` attributes** (`keepAriaAttrs`, `keepRoleAttr`) — SVGO's
  default `removeUnknownsAndDefaults` doesn't always recognize these as
  meaningful and can strip them; `Accessibility.md` and `SVG-Rules.md` both
  require them on every file, so this override is mandatory, not optional.
- **`<defs>` that look unused but aren't** (`removeUselessDefs: false`) —
  relevant for the icon sprites specifically, where a `<symbol>` inside
  `<defs>` looks "unused" to a static analyzer that doesn't trace `<use>`
  references across the file it's assembled into later.

## Path data precision

`convertPathData: { floatPrecision: 2 }` rounds path coordinates to 2
decimal places. This is a deliberate balance: enough precision that
computed geometry (arc endpoints, aimed-FOV rays) doesn't visibly shift,
while trimming the excess precision that a script-generated coordinate
(e.g. `127.34999999999999`) would otherwise carry into the shipped file.

## What NOT to over-optimize

Do not chase byte count below its budget once an asset is already under
it (see `Performance.md`'s "actual vs. budget" table — nearly everything
in this project is already an order of magnitude under budget). Squeezing
further bytes out of an asset that's already at 3KB against a 20KB budget
risks trading legibility of the source (harder-to-read path data, overly
aggressive precision loss) for a savings that has no practical effect on
load time. Optimize until the budget is comfortably met with margin, then
stop.
