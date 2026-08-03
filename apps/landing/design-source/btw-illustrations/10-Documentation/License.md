# License

## Current state — please read before treating this as final

Every manifest in this project (`manifest/*.json` and each asset folder's
own `manifest/<asset>.json`) currently lists `"license": "MIT"`. **This was
a placeholder choice made during development, not a confirmed legal
decision** — no license was specified in any of the original briefs this
project was built from, and "MIT" was used as a reasonable, permissive
default for a manifest schema that required *some* value in that field.

Before this project is actually published or distributed under any
license claim, get real confirmation from whoever owns the BTW product's
legal/licensing decisions. In particular:

- **Code-style permissive licenses (MIT, Apache 2.0, etc.) are a normal
  choice for generic UI icons and illustration components** (the kind of
  thing many open design systems do license this way) — MIT is a
  defensible default for `05-Icons`' flat icon set, `04-Hero-Illustration`,
  and `06-Privacy-Illustration`.
- **Brand assets almost never carry the same license as generic code/design
  assets.** `05-Icons/brand/` (logo, logo-mark, favicon, app-icon,
  apple-touch-icon, mask-icon) and `08-Favicon/` are built from the BTW
  brand mark specifically — these typically need their own, much more
  restrictive usage terms (e.g., "may be used to refer to the BTW product,
  may not be modified, may not be used to imply endorsement") rather than
  a permissive open-source license that would technically allow anyone to
  reuse the mark itself for unrelated purposes. Treat every `MIT` label
  currently attached to a brand-mark file as the placeholder it is, not a
  real grant.
- **Open Graph's exported images** (`07-OpenGraph/exports/`) contain the
  brand mark and product name as rendered content, not just as a
  reference — the same brand-asset caution above applies to those export
  files even though they're PNG/WebP/JPG rather than SVG.

## What to do if you're picking this up

1. Get an actual decision on: (a) a license for the generic
   icons/illustrations, and (b) separate usage terms for anything
   containing the brand mark or wordmark.
2. Update every manifest's `license` field to reflect that real decision
   — search for `"license": "MIT"` across `manifest/` and every asset
   folder's own manifest, and update all of them consistently, not just
   the centralized copy.
3. Add a proper `LICENSE` file at the repository root reflecting whatever
   was decided, since a JSON field alone isn't a substitute for an actual
   license file most tooling and contributors expect to find.
4. If brand and non-brand assets end up under genuinely different terms,
   say so explicitly in this document (a single "License.md" implying one
   uniform license, when two different ones actually apply, would be
   actively misleading) — split this file into two if that's what's
   needed, or add a clear per-family table here.

## Asset attribution

None of the illustrations, icons, or the favicon in this project were
derived from a third-party icon library, stock illustration, or template
— everything was constructed from scratch (computed geometry — arcs,
angles, offsets — rather than traced or copied from an existing source).
There is no third-party attribution requirement to carry forward for any
file currently in this repository.

## Fonts

`05-Icons/brand/logo.svg`'s wordmark uses an SVG `<text>` element set in
`Arial, Helvetica, sans-serif` — a system font stack, not an embedded or
bundled font file. No font-licensing obligation applies to this project as
a result, but also no guarantee that the wordmark renders identically
everywhere it's viewed (see `Components.md`'s Logo entry, and
`05-Icons/docs/DesignRules.md`) — converting the text to path outlines in
a design tool removes that font-availability dependency entirely, which is
recommended before this asset ships anywhere that can't guarantee a
system sans-serif is present.
