# Manifest Format

Every asset family has its own detailed manifest (e.g.
`04-Hero-Illustration/manifest/hero.json`), and there's a second,
centralized `manifest/` folder at the project root with a normalized
summary of each. This document covers both.

## Common schema

The centralized `manifest/` folder's 7 files (`hero.json`, `privacy.json`,
`icons.json`, `favicon.json`, `og.json`, `tokens.json`, `project.json`) all
conform to one shared shape:

```json
{
  "id": "hero",
  "version": "1.0.0",
  "viewBox": [0, 0, 1200, 900],
  "components": [],
  "exports": [],
  "tokens": "tokens.json",
  "license": "MIT"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | lowercase, kebab-case, matches the asset's conceptual name (`hero`, `og-image`, not the folder number) |
| `version` | string | yes | strict SemVer `X.Y.Z` — see Versioning below |
| `viewBox` | `[number, number, number, number]` | yes | matches the asset's master SVG exactly |
| `components` | `string[]` | yes | names of reusable components this asset uses (see `Components.md`) — may be empty for assets with no sub-components (favicon) |
| `exports` | `string[]` | yes | relative paths to every file this manifest is describing the shipped state of |
| `tokens` | string | yes | relative path to the tokens file this asset draws its palette from — always `"tokens.json"` for the centralized manifests |
| `license` | string | yes | always `"MIT"` currently — see `License.md` |

## Detailed (per-folder) manifests

Each asset folder's own `manifest/<asset>.json` is richer than the common
schema — it's the actual source of truth for that asset's specifics
(canonical geometry, per-variant file sizes, stable element IDs, animation
rules, etc.), predating this project-wide common-schema requirement. The
centralized `manifest/` folder's files point back to these via a
`detailedManifest` field:

```json
{
  "id": "hero",
  "version": "2.1.0",
  "...": "...",
  "detailedManifest": "04-Hero-Illustration/manifest/hero.json",
  "note": "..."
}
```

Treat the detailed manifest as authoritative for anything the common
schema doesn't cover; treat the centralized one as the quick, uniform entry
point for tooling that wants to iterate over every asset family the same
way without knowing each one's bespoke extra fields.

## Versioning

Strict SemVer (`MAJOR.MINOR.PATCH`) for every file in the centralized
`manifest/` folder — this is a hard requirement introduced by the v5.1
specification that folder was built against. **The per-folder detailed
manifests predate that requirement** and use shorter version strings
(`"1.0"`, `"2.1"`) — those were not rewritten retroactively; the
centralized manifest's version field for that same asset uses the SemVer-
compliant equivalent instead (`hero.json`'s detailed manifest says `"2.1"`,
the centralized one says `"2.1.0"` for the same release).

When bumping a version:
- **PATCH** (`x.x.N+1`) — geometry/color fix that doesn't change the
  asset's public shape (a corrected arrow direction, a nesting-depth fix).
- **MINOR** (`x.N+1.0`) — new variant added, new component added, backward-
  compatible manifest field added.
- **MAJOR** (`N+1.0.0`) — canvas/viewBox changed, a component's parameters
  changed in a way that breaks an existing consumer, a token's hex value
  changed.

## Compatibility

Real JSON Schema files (Draft 2020-12) now back this: `manifest/schemas/`
contains `project.schema.json`, `tokens.schema.json`, and
`asset-manifest.schema.json`. Every file in `manifest/` is validated
against the matching schema by `tooling/validate.py` — not just
documented as conforming, actually checked on every run. See
`tooling/validation-report.md` for the current, real output of that check
(last run: 0 schema violations across all 7 manifests).

The validator itself (`tooling/schema_validator.py`) is a minimal,
dependency-free implementation covering the subset of JSON Schema these
three files actually use (`type`, `required`, `properties`,
`patternProperties`, `pattern`, `const`, `enum`, `minItems`/`maxItems`,
`items`, `minProperties`) — not the full spec. It exists because the
environment this was built in has no network access to install the real
`jsonschema` PyPI package; if you have network access and want full
JSON Schema spec coverage (`$ref` resolution, `allOf`/`anyOf`/`oneOf`,
etc.), swap in the real package — the schema *files* themselves are
standard JSON Schema and don't depend on which validator reads them.

## Examples

**Minimal valid manifest** (hypothetical new asset, "example"):
```json
{
  "id": "example",
  "version": "1.0.0",
  "viewBox": [0, 0, 100, 100],
  "components": [],
  "exports": ["example.svg"],
  "tokens": "tokens.json",
  "license": "MIT"
}
```

**`tokens.json`'s shape is intentionally different** from the common
schema above — it has no `viewBox` or `components` (it isn't a
renderable asset, it's the shared palette every other manifest points at).
See `manifest/tokens.json` directly, or `Design-Tokens.md` for its content
explained.

**`project.json`'s shape is also different** — it's the top-level index
listing every asset family and pointing at each one's manifest, plus a
description of the common schema itself and an `acceptanceCriteriaStatus`
block tracking whether this whole manifest system currently satisfies its
own requirements. See `manifest/project.json` directly.
