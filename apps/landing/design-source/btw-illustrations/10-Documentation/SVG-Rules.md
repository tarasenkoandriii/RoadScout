# SVG Rules

The hard constraints every SVG in this project follows, no exceptions.
*(This document also folds in the project's Appendix A, "SVG Production
Standards" — it's the same subject, split across two sections of the
original brief; kept together here since splitting them would mean
repeating half of each.)*

## Forbidden, always

| Element | Why |
|---|---|
| `<filter>` | Filters are expensive to render, behave inconsistently across browsers/renderers at small sizes, and this project's flat, layered-opacity visual language never needs one — every "glow" or "depth" effect here is achieved with plain opacity layering instead. |
| `<script>` | These are static assets, consumed in contexts (email clients, social-platform scrapers, `<img>` tags) that don't execute embedded scripts anyway, and allowing script would turn a design asset into an attack surface for anywhere it's embedded. |
| `<image>` (raster embedded in vector) | Defeats the entire point of shipping vector assets — infinite scaling, tiny file size, crisp rendering at any size — by smuggling a fixed-resolution bitmap inside. If an asset needs a photo, it's not one of these assets. |
| `<foreignObject>` | Allows arbitrary embedded HTML/CSS inside an SVG, which breaks the "this is a self-contained, portable vector file" guarantee every consumer of these assets relies on (a `<use>` reference, an `<img src>`, a raw file open in a design tool). |

Checked automatically wherever a validation pass exists in this project
(see `Validation.md`); also checkable by hand with a simple search:

```bash
grep -l 'filter\|<image\|<script\|foreignObject' path/to/file.svg
```

No output means clean.

## Required, always

| Attribute | Why |
|---|---|
| `viewBox` | The coordinate system every other number in the file is relative to — without it, `width`/`height` alone don't let the asset scale. |
| Unique `id`s | Any two elements sharing an `id` in the same file is undefined/broken behavior; when a file enters a sprite (see `05-Icons/sprites/`), uniqueness has to hold across every file in that sprite too, not just within one. |
| `role="img"` | Marks the element as an image for assistive technology and tooling, even when paired with `aria-hidden="true"` for purely decorative uses — see `Accessibility.md` for when to use one vs. both. |
| `width` + `height` | A concrete default render size, even though `viewBox` is what actually controls scaling — omitting these can cause inconsistent default sizing across browsers when an SVG is dropped into a page with no explicit CSS size. |
| SVGO optimization | Every shipped SVG should pass through SVGO before being considered final — see `Optimization.md` for the exact config and what it does/doesn't touch. |

## Coordinates on the grid

Illustration coordinates should land on multiples of 8 where the design
allows it (`Design-System.md`). This project's own founding specification
doesn't perfectly follow its own rule in a few places (see `Hero.md`) —
where an explicit number is given by a brief, that number wins over the
general grid rule. Don't retroactively "fix" existing geometry to satisfy
this rule unless specifically asked to.

## Colors only from Design Tokens

Every color used in every SVG in this project traces back to
`manifest/tokens.json`. No file introduces a color not in that set. This is
checked with a simple grep for hex codes and a set-difference against the
known token list — see `Validation.md`.

## Size budgets (after optimization)

| Asset | Budget |
|---|---|
| Hero | ≤20KB |
| Privacy | ≤8KB |
| Icons | ≤2KB |
| Favicon | ≤1KB |
| Open Graph | ≤30KB |

Full detail and current actual sizes in `Performance.md`.

## Format compatibility

- **SVG 1.1 / SVG 2 compatible** — no experimental or browser-specific
  features. Every element used across this project (`path`, `rect`,
  `circle`, `ellipse`, `line`, `polygon`, `polyline`, `text`, `g`,
  `symbol`, `use`, `style` with `@keyframes`, `transform`) is part of
  stable SVG 1.1, supported everywhere listed in `Browser-Support.md`.
- **UTF-8 encoding**, always.
- **One asset, one master SVG** — even where multiple size/theme variants
  exist (Hero has 5, Privacy has 4, Open Graph has 5), each traces back to
  one canonical master that the others are derived from or documented as
  an intentional alias of (see each asset's own `.md` file in this folder
  for which variant is the master and which are derived/aliased).

## Quality control, before calling any SVG done

- **W3C SVG validation** — the file is well-formed XML and uses only valid
  SVG elements/attributes. A quick local check: `python3 -c "import
  xml.etree.ElementTree as ET; ET.parse('file.svg')"` catches malformed
  XML; full W3C conformance needs the actual validator for anything beyond
  well-formedness.
- **Render in Chrome, Firefox, Safari, Edge** — see `Browser-Support.md`.
- **Pixel Perfect** — rendered output matches the intended element
  positions, not just "looks roughly right" — see `Validation.md`'s
  bounding-box-check approach, which is how several real geometry bugs
  were caught in this project's own development.
- **Verify PNG/WebP exports render correctly** wherever an asset ships
  raster formats — see `Export-Guide.md`.
