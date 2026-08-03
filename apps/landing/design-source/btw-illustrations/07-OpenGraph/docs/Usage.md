# Usage — Open Graph

## Meta tags

Use the raster exports, not the SVG — `og:image` and Twitter Card consumers
(Telegram, LinkedIn, Facebook, X, Discord, iMessage, Slack) do not render
SVG. Point them at `exports/png/og-image.png` (safest, universal support) or
`exports/jpg/og-image.jpg` (smaller, fine for photographic-feeling contexts —
this one's mostly flat vector art, so PNG usually looks marginally cleaner
at the same file size).

```html
<meta property="og:image" content="https://yourdomain/og/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/png" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://yourdomain/og/og-image.png" />
```

WebP (`exports/webp/og-image.webp`) is the smallest of the three and fine to
serve as a *fallback-aware* alternative where you control the consumer (e.g.
your own share sheet, a Slack app card built via API rather than raw
`og:image` scraping) — but don't rely on it for `og:image` itself; several
scrapers (notably older Facebook/LinkedIn crawlers) don't reliably fetch
WebP, hence PNG as the meta-tag default.

## Choosing a variant

- **Default embed** → `og-image.png` (or `.jpg`/`.webp`). Full composition,
  dark background, matches the product's own visual language.
- **Light-themed page/email** → export `master/og-image-light.svg` yourself
  (see `docs/ExportGuide.md`) if the embedding context specifically needs a
  light card; most `og:image` consumers render their own chrome around the
  image regardless of the page's theme, so this is rarely necessary for
  `og:image` itself — it exists for contexts where *you* control the
  surrounding design (e.g. a light-themed blog post embedding the image
  directly, not through Open Graph scraping).
- **`og-image-no-text.svg`** → useful when the consuming surface already
  renders its own title/description text next to the image (many chat
  apps do) and repeating the wordmark/title inside the image itself would
  be redundant — export this one instead of the default if that's your
  situation.
- **`og-image-minimal.svg`** → smallest, calmest option — logo + phone only,
  no camera/route detail. Good for tight thumbnail contexts (a small avatar-
  sized preview, a favicon-adjacent link chip) where the full scene would
  just be visual noise at that size.

## Reviewing before shipping

`social-previews/*.png` are approximate mockups of how the image sits inside
each platform's typical link-preview card layout — a quick gut-check for
crop, contrast, and text legibility before you push a change live. They are
**not** a substitute for testing against the platforms' actual debug tools,
which validate the live meta tags on your real URL:

- Telegram: send the link to yourself, or use `@WebpageBot`
- LinkedIn: https://www.linkedin.com/post-inspector/
- Facebook: https://developers.facebook.com/tools/debug/
- X: https://cards-dev.twitter.com/validator (largely deprecated but still
  used informally; X now mostly reflects `og:image` directly)
- Discord: paste the link in any channel you control — Discord fetches live,
  no separate debug tool

Run the real debug tool after any change to the meta tags or the exported
image — cached previews on these platforms are notoriously sticky, and the
mockups here can't tell you whether a platform is still serving a stale
cached card from before your edit.

## React / component usage

```jsx
<OGImage />              {/* master/og-image.svg, for in-app preview/editor use only */}
```

The SVG components are for *previewing* the asset inside your own tooling
(a CMS "preview my share card" panel, a design-system Storybook entry) — the
live `<meta>` tags always point at the raster export, never the SVG
directly, per the first section above.
