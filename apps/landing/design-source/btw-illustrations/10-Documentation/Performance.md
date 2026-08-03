# Performance

## Target sizes (budgets)

| Asset | Budget | Actual (current) |
|---|---|---|
| Hero (each variant) | ≤20KB | 2.8–3.5KB |
| Privacy (each variant) | ≤8KB | 5.7–6.2KB |
| Icons (each flat icon) | ≤2KB | 0.3–0.9KB |
| Favicon (master SVG) | ≤1KB | ~0.5KB |
| Open Graph (master SVG) | ≤30KB (after SVGO) | ~3.4KB (before SVGO even runs) |

Every asset currently in this project is well under its budget — in
several cases (Hero, Icons, Open Graph) by an order of magnitude. This is
mostly a consequence of the flat, layered-opacity visual language (no
gradients, no embedded raster, no filters) rather than aggressive
optimization work — see `Optimization.md` for what optimization *is* still
worth doing even when a budget is already comfortably met.

## Why these specific budgets

- **Hero (≤20KB)** — the landing page's above-the-fold hero image; large
  enough that render-blocking file size matters for perceived load time,
  but the flat vector style makes 20KB generous headroom rather than a
  tight constraint.
- **Privacy (≤8KB)** — a secondary, further-down-the-page illustration;
  smaller budget reflects its smaller canvas (800×400 vs. Hero's 1200×900)
  and lower priority for above-the-fold load performance.
- **Icons (≤2KB)** — icons are used dozens of times per page (navigation,
  status indicators, buttons); even a small per-file overhead compounds
  fast at that multiplicity, so the budget is deliberately tight relative
  to Hero/Privacy.
- **Favicon (≤1KB)** — loaded on every single page view, cached
  aggressively by browsers, and visually the simplest asset in the
  project — there's no legitimate reason for it to be large.
- **Open Graph (≤30KB after SVGO)** — this is the *source* SVG's budget,
  not the shipped raster export's; `og:image` consumers never render the
  SVG directly (see `Export-Guide.md`), so this budget is about keeping
  the master file itself lean for anyone who does open/edit it, not about
  end-user load time.

## What drives file size in practice

In order of actual impact, based on this project's own files:

1. **Number of distinct shapes/paths** — the single biggest factor. A
   composition with 10 simple shapes will always beat one with 3 complex
   multi-point paths of the same visual complexity, if the 3 complex paths
   have more total command/coordinate data.
2. **Coordinate precision** — `M12.333333 8.666667` vs. `M12.33 8.67`
   costs real bytes at scale, especially in a file with dozens of
   coordinate pairs (a full illustration composition, not a single icon).
   SVGO's `convertPathData` with `floatPrecision` handles this — see
   `Optimization.md`.
3. **Repeated inline styling** — writing `fill="none" stroke="#F8FAFC"
   stroke-width="2" stroke-linecap="round"` on every single element
   instead of once on a wrapping `<g>` adds up across a composition with
   many similar elements (e.g., Hero's camera markers, Icons' consistent
   stroke treatment).
4. **Comments and whitespace** — negligible after gzip, but SVGO strips
   these anyway as part of its default optimization pass.
5. **Unused/leftover definitions** — an unreferenced `<defs>` entry, a
   component's commented-out alternate path (see
   `05-Icons/components/CameraMarker.svg`'s documented `drop`-type
   alternative, which is intentionally a comment, not shipped markup) —
   worth a periodic sweep, not something to obsess over per-file.

## Verifying a budget is met

```bash
wc -c path/to/file.svg     # raw byte count
```

For anything close to its budget (nothing currently is, but future assets
might be), re-check *after* running SVGO, not before — the budgets in this
document and in each asset's own manifest are post-optimization numbers.
