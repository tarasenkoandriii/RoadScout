# BTW SVG Design System — Documentation

This is the documentation index for the Beyond the Wall SVG design system:
a production asset library covering hero illustration, privacy explainer,
icons, Open Graph, and favicon, all built on one shared set of tokens and
conventions. If you're new here — human, or an AI agent picking this up
cold — start with this file, then go to whichever document matches your
task.

## What this project is

BTW ("Beyond the Wall") is a civic-tech app that tells people where nearby
cameras are, using only geometry and on-device location — never video, never
a network connection to the cameras themselves. This repository is the
**visual asset system** for that product: every illustration, icon, social
share image, and favicon it ships with, plus the tooling conventions that
keep all of it consistent as it grows.

## Directory structure

```
01-Canonical-Geometry/       the original 8px-grid geometry spec (phone/scan-cone/camera anchors)
02-Foundation/                design tokens, schemas, validation config (source of the palette)
03-SVG-Component-Library/     first-generation component set (superseded by 04/06, kept for history)
04-Hero-Illustration/         hero.svg + 4 responsive variants + 5 reusable components
05-Icons/                     76 SVGs across 9 families (core/camera/detection/nav/privacy/status/ui/hero/brand)
06-Privacy-Illustration/      privacy.svg + 3 variants + 9 reusable components
07-OpenGraph/                 og:image system — 5 master variants, PNG/WebP/JPG exports, social mockups
08-Favicon/                   favicon.svg master + 9 platform exports
09-Previews/                  centralized light/dark/social/thumbnail previews of everything above
manifest/                     7 normalized JSON manifests (one per asset family + tokens + project)
manifest/schemas/             JSON Schema (Draft 2020-12) files those manifests validate against
tooling/                      validate.py — real, dependency-free validation script + its report
10-Documentation/             you are here
```

Each numbered asset folder (04, 05, 06, 07, 08) contains its own detailed
`README.md` and `manifest/*.json` — those are the source of truth for that
asset's specifics. This documentation folder is where the *cross-cutting*
material lives: things that are true across every asset family, and things
you need to know before you've picked a specific one to work on.

## Quick start

1. Read `Getting-Started.md` for how to set up, where files go, and the
   rules for creating a new SVG.
2. Read `Design-System.md` and `Design-Tokens.md` for the shared visual
   language (grid, palette, stroke widths) before drawing anything.
3. Pick the asset-specific doc that matches your task: `Hero.md`,
   `Privacy.md`, `Icons.md`, `OpenGraph.md`, or `Favicon.md`.
4. Before shipping anything, run it past `Validation.md`'s checklist and
   `SVG-Rules.md`'s hard constraints.

## Requirements

- No build tooling is required to *view* any asset — every file here is a
  plain, static SVG, PNG, WebP, JPG, ICO, or JSON file. Open any `.svg`
  directly in a browser or image viewer.
- To *optimize* SVGs, [SVGO](https://github.com/svg/svgo) (referenced from
  `05-Icons/svgo.config.json`) — see `Optimization.md`.
- To *regenerate* raster exports from a master SVG, any SVG-to-raster
  renderer that supports inline `<style>`/`@keyframes` and `<text>` will
  do — see each asset folder's own Export/Usage doc, and this folder's
  `Export-Guide.md` for the shared conventions.
- No JavaScript runtime, no server, no database. This is a static asset
  library, not an application.

## Where to go next

| I want to... | Read |
|---|---|
| Understand how the whole system fits together | `Architecture.md` |
| Learn the shared design language before drawing something | `Design-System.md`, `Design-Tokens.md` |
| Look up a specific reusable component (Phone, ScanCone, etc.) | `Components.md` |
| Work on the hero illustration | `Hero.md` |
| Work on the privacy explainer | `Privacy.md` |
| Work on an icon | `Icons.md` |
| Work on the Open Graph / social share image | `OpenGraph.md` |
| Work on the favicon | `Favicon.md` |
| Understand the JSON manifest format | `Manifest.md` |
| Export something to PNG/WebP/ICO | `Export-Guide.md` |
| Know what's forbidden/required in every SVG | `SVG-Rules.md` |
| Name a new file/component/id consistently | `Naming.md` |
| Check accessibility requirements | `Accessibility.md` |
| Check which browsers are supported | `Browser-Support.md` |
| Check a file-size budget | `Performance.md` |
| Run the optimization pipeline | `Optimization.md` |
| Validate an asset before shipping | `Validation.md` |
| Find an answer to a common question | `FAQ.md` |
| See what changed between versions | `Changelog.md` |
| Check license/usage terms | `License.md` |

## Definition of done for this documentation

This documentation set is complete when a new contributor — human or AI —
can, using only these files:

1. Understand the architecture (`Architecture.md`).
2. Create a new SVG that follows the system's rules (`SVG-Rules.md`,
   `Design-System.md`, `Naming.md`).
3. Add a new reusable component (`Components.md`'s template).
4. Export an asset to every required format (`Export-Guide.md`).
5. Validate it and know whether it's ready to ship (`Validation.md`).

If any of those five things requires asking someone a question this
documentation should have answered, that's a documentation bug — flag it.
