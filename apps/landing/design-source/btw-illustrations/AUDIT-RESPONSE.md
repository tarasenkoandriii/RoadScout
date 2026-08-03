# Response to BTW-v5-Audit-and-Recommendations.md

## Important context first

This audit's **~40-50% readiness estimate** was computed against a
snapshot of `btw-illustrations.zip` that predates `08-Favicon/`,
`09-Previews/`, `10-Documentation/`, and the centralized `manifest/`
folder entirely — its own "content of the assets archive" listing stops
at `07-OpenGraph/master/og-image-minimal.svg` and never shows those four
additions. Several of its "Основные несоответствия" were already resolved
by the time this specific audit ran. This document distinguishes what was
**already done before this audit** from what this pass **newly adds in
response to it**, rather than claiming credit either way it doesn't
belong.

The audit also references a `BTW-SVG-v5-Specification.zip` whose contents
were not provided to me — only its file listing appears in the audit
document. Where a recommendation depends on details of that spec I haven't
seen (exact schema shape it expects, `examples/phone.json`'s exact
content), I've built a reasonable, consistent equivalent from what this
project already established and documented every assumption, rather than
guessing at an unseen file's specifics.

## P0 — high priority

| Recommendation | Status | Detail |
|---|---|---|
| Единый `project.json` | **Already existed**, updated this pass | `manifest/project.json` was created in an earlier pass; this pass added the missing `09-Previews`/`10-Documentation` entries, added `schemas`/`validation` sections, and recorded this audit's findings in a new `auditHistory` field. |
| JSON Schema для манифестов | **New, added this pass** | `manifest/schemas/{project,tokens,asset-manifest}.schema.json` — real JSON Schema (Draft 2020-12) files, actually enforced by `tooling/validate.py` on every run, not just documented as a shape. |
| Унифицировать Design Tokens | **Already existed**, unchanged | `manifest/tokens.json` — consolidated across all 5 illustration/icon/favicon families since the previous pass. |
| Hero как эталонная композиция | **Already complete** | 5 variants, audited against the founding specification in an earlier pass (exact geometry match confirmed: phone, scan-cone, camera positions, marker/FOV parameters). |

## P1 — medium priority

| Recommendation | Status | Detail |
|---|---|---|
| ~70 SVG-компонентов/иконок | **Already complete** | 76 across 9 families in `05-Icons/` (60 flat icons + 10 hero-family + 6 brand). |
| SVG Sprite | **Already existed**; two real bugs fixed this pass | `05-Icons/sprites/sprite.svg` + `sprite-symbol.svg` were missing `role="img"`/`aria-hidden="true"` on their root element — fixed. |
| Экспорт PNG/WebP/ICO | **Already complete** | `07-OpenGraph/exports/{png,webp,jpg}/`, `08-Favicon/exports/` (PNG at 6 sizes + `.ico` bundling all 3 browser sizes). |
| Контактные листы превью | **Already existed**; one real bug fixed this pass | The icon contact sheet used an ad-hoc gray (`#94A3B8`) instead of the real `muted` token and an unparseable 8-digit alpha-hex for borders — both fixed, regenerated in both locations (`05-Icons/previews/` and `09-Previews/`). |

## P2 — lower priority

| Recommendation | Status | Detail |
|---|---|---|
| Визуальные regression-тесты | **Partial** | The *methodology* (render, measure element bounding boxes, compare to expected) is real and was used throughout this project's development — it caught three actual bugs in earlier work. It runs by hand, not as an automated gate. Not overclaiming this as "done." |
| CI/CD с автоматической валидацией | **Partial** | `tooling/validate.py` is real, runnable, and dependency-free — see `tooling/validation-report.md` for actual output (0 errors, 0 warnings, 16 findings isolated to the explicitly-historical `03-SVG-Component-Library/` folder). It is **not** wired into an actual CI/CD provider — there's no git host or CI config in this archive for it to hook into. That's genuine remaining work, called out explicitly rather than implied as finished. |
| Генерация ассетов из JSON Manifest | **Not done** | Manifests currently *describe* what a generator script produced; a manifest-driven generator that produces the SVG *from* the manifest (the reverse direction) doesn't exist. Flagged as real future work in `10-Documentation/Changelog.md`'s Unreleased section, not silently skipped. |

## What was actually fixed in this pass (bugs, not just gaps)

Running the new validator against the real archive surfaced genuine
issues, not just documentation gaps:

1. **`05-Icons/hero/Arrow.svg` and `Cloud.svg`** were copied from the
   legacy `03-SVG-Component-Library` and never updated to the current
   family's own compliance bar (missing `width`/`height`/`role="img"`/
   `aria-hidden="true"`). Fixed.
2. **The icon contact sheet** used a color that didn't match any real
   design token, and a raw alpha-hex value the color-compliance check
   couldn't parse. Fixed — regenerated with the real `muted` token and a
   token+opacity border instead.
3. **The icon sprite files** were missing required root-level
   accessibility/role attributes. Fixed.
4. **`manifest/project.json`** was stale — missing two whole asset
   folders from its own asset list. Fixed.

None of these were visible from the audit document itself (which worked
from a file listing, not a compliance scan) — they surfaced from actually
running a validator against the shipped files, which is the point of
having one.

## Current validation status (real, not claimed)

```
PASSED:            19
WARNINGS:          0
ERRORS:            0
LEGACY (accepted): 16   — all isolated to 03-SVG-Component-Library
```

Full output in `tooling/validation-report.md`, regenerate any time with
`cd tooling && python3 validate.py <path-to-merged_project>`.

## Honest remaining gaps

- No CI/CD provider integration (no git host exists for this archive to
  integrate with in the first place).
- No manifest-driven asset *generation* (only manifest-driven
  *description* of what was generated).
- No automated pixel-regression gate (the methodology is real and proven,
  the automation of it into a CI step is not built).

These are real, and they're the honest reason this project isn't at
"100%" against whatever the full, unseen v5 specification actually
demands. They're recorded in `10-Documentation/Changelog.md`'s
`[Unreleased]` section and `manifest/project.json`'s
`acceptanceCriteriaStatus`, not hidden.
