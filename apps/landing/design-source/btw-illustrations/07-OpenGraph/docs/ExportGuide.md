# Export Guide — Open Graph

How `exports/` was produced from `master/og-image.svg`, and how to
regenerate it if the source changes.

## Pipeline used for this build

1. Render `master/og-image.svg` to a 1200×630 raster at 1x (no supersampling
   needed — this is flat vector art with no fine detail that benefits from
   downsampling from a larger render; a straight 1:1 rasterization is
   already clean).
2. From that raster:
   - **PNG** — saved directly, `optimize=True`. Lossless, universal support,
     the safe default for `og:image`.
   - **WebP** — `quality=90, method=6` (method 6 = slowest/best compression
     Pillow's WebP encoder offers — fine to spend the extra encode time
     since this runs once per release, not per request).
   - **JPEG** — `quality=90, optimize=True`. No alpha channel needed (the
     background is always a solid fill), so JPEG's lack of transparency
     support isn't a limitation here.

## Regenerating after an edit to og-image.svg

Any SVG-to-raster renderer that supports inline `<style>`/`@keyframes` and
`<text>` will do (this build used a headless WebKit renderer). Rough
equivalent using a Node/Puppeteer or `resvg`/`rsvg-convert` pipeline:

```bash
# Example with resvg (rasterizes at exactly 1200x630, matching the viewBox):
resvg master/og-image.svg exports/png/og-image.png -w 1200 -h 630

# Then derive webp/jpg from that PNG with any image library, e.g. Pillow:
python3 -c "
from PIL import Image
im = Image.open('exports/png/og-image.png').convert('RGB')
im.save('exports/webp/og-image.webp', quality=90, method=6)
im.save('exports/jpg/og-image.jpg', quality=90, optimize=True)
"
```

If you switch renderers, re-check the CSS `@keyframes` animation on the FOV
cones doesn't leak into the raster as a mid-animation frame — capture at
`t=0` (or on the renderer's first paint) so exports always land on the
"resting" 0.16-opacity state, not a random point mid-pulse.

## Regenerating the SVGO-optimized source

The brief's acceptance criteria ask for the *source* SVG to be under 30KB
after SVGO. `master/og-image.svg` is already ~3.4KB unoptimized — comfortably
under budget without SVGO — but if you want the optimized copy for shipping:

```bash
svgo --config ../05-Icons/svgo.config.json master/og-image.svg -o master/og-image.min.svg
```

(Reusing `05-Icons/svgo.config.json` rather than duplicating it — its
`removeDimensions` override should be disabled for this file the same way
it's disabled for `04-Hero-Illustration`/`06-Privacy-Illustration`, since
`og-image.svg` needs concrete pixel dimensions, not a CSS-sizeable icon.)

## Regenerating social-previews/

These are layout mockups (HTML + CSS wrapping `exports/png/og-image.png`),
rendered to PNG at each platform's approximate card width. If the source
image or title/description copy changes, re-render each mockup — they don't
update automatically and aren't fetched live from anywhere.

## Regenerating an og-image-light export

Only `og-image.svg` is exported to raster in this build (that's the variant
that actually ships in `<meta property="og:image">`). If a project ever needs
a shipped light-mode raster too, repeat the same three-format export pipeline
above against `master/og-image-light.svg` into a parallel
`exports/png/og-image-light.png` (etc.) — no filenames are reserved for this
yet, so pick a convention (a `-light` suffix matching the source file is the
obvious one) and update `manifest/og.json → exports` accordingly.
