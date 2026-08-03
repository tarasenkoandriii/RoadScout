# Export Guide

How each asset family's raster exports were produced, and how to regenerate
them. Per-asset detail lives in that asset's own folder
(`07-OpenGraph/docs/ExportGuide.md` is the fullest example); this document
is the shared, cross-family version.

## Formats, by asset family

| Family | SVG | PNG | WebP | JPG | ICO |
|---|---|---|---|---|---|
| Hero | ✓ (5 variants) | preview only | — | — | — |
| Privacy | ✓ (4 variants) | preview only | — | — | — |
| Icons | ✓ (76 files + 2 sprites) | preview only | — | — | — |
| Open Graph | ✓ (5 variants) | ✓ | ✓ | ✓ | — |
| Favicon | ✓ (1 master) | ✓ (6 sizes) | — | — | ✓ (bundled) |

"Preview only" means the PNG that exists (`09-Previews/light|dark/*.png`)
is for documentation/review, not a shipped production asset — Hero,
Privacy, and Icons are consumed as SVG directly by whatever renders them
(a web page, a native app, a design tool). Open Graph and Favicon are the
two families that *must* ship raster, because their consumers (social
platforms' link scrapers, browser tab chrome) don't render SVG at all.

## SVG → PNG

Any SVG-to-raster renderer that supports inline `<style>`/`@keyframes` and
`<text>` will do — this project's own builds used a headless WebKit
renderer (`wkhtmltoimage`). Two things to know if you use a different one:

1. **Capture the resting animation frame, not a random mid-pulse one.**
   Files with the CSS `@keyframes` animation (Hero, Privacy, OpenGraph's
   default/light variants) should be captured at `t=0` or on first paint,
   landing on the documented resting opacity, not an arbitrary point in the
   pulse cycle.
2. **Check your renderer's transparency behavior before assuming it.**
   `wkhtmltoimage` always composites onto an opaque page background with
   no transparent-output mode — this was discovered while building the
   favicon exports, which genuinely need transparency. The workaround used
   (documented fully in `08-Favicon/README.md` and `Favicon.md`): render
   once against a `#FF00FF` chroma-key background (a color nowhere near any
   real color in the mark), then convert each pixel's distance from that
   exact magenta into an alpha value.

## PNG → WebP / JPG

Both were derived from the already-rendered PNG using Pillow, not by
re-rendering the SVG a second time per format:

```python
from PIL import Image
im = Image.open("og-image.png").convert("RGB")
im.save("og-image.webp", quality=90, method=6)   # method=6 = slowest/best compression
im.save("og-image.jpg", quality=90, optimize=True)
```

No alpha channel is needed for Open Graph's exports (the background is
always a solid fill), so JPEG's lack of transparency support isn't a
limitation there.

## PNG → ICO

```python
from PIL import Image
master = Image.open("favicon-512-transparent.png")  # single RGBA source
master.save("favicon.ico", format="ICO", sizes=[(16,16),(32,32),(48,48)])
```

**Watch for this specific mistake:** passing `sizes=[...]` to a single base
image is the correct call — Pillow resizes internally per requested size.
An earlier attempt at this during development instead passed a list of
*pre-resized* images via `append_images` (a pattern that works for
multi-frame GIF/TIFF, not ICO), which silently produced an `.ico` containing
only one embedded resolution instead of three. Always verify after the
fact — read the ICO's own directory header, don't just trust that the save
call succeeded without error:

```python
import struct
with open("favicon.ico", "rb") as f:
    data = f.read()
_, _, count = struct.unpack("<HHH", data[0:6])
print(f"{count} images embedded")   # should be 3, not 1
```

## Multiple sizes from one master (Favicon, Icons)

Never re-render the source SVG once per target size if you can avoid it —
render once at the largest size needed (or higher, for oversampling
headroom), then downsample with a high-quality filter (Lanczos) for every
smaller size. This guarantees every exported size traces back to exactly
the same source pixels, and it sidesteps renderers (like the one used
here) that don't reliably honor small `--width`/`--height` render requests
in the first place.

## Apple Touch Icon — the one export requiring different handling

Unlike every other favicon export, `apple-touch-icon.png` should **not**
carry transparency or pre-baked corner rounding. Composite it onto a solid
background before saving:

```python
bg = Image.new("RGB", (180, 180), (15, 23, 42))  # bg token, solid
icon = master.resize((180, 180), Image.LANCZOS)
bg.paste(icon, (0, 0), icon)  # icon's own alpha channel as the paste mask
bg.save("apple-touch-icon.png")
```

iOS composites transparency to black if you don't provide a background,
and applies its own corner-radius mask on top of whatever you give it — so
pre-rounding it yourself double-rounds the icon.

## Verifying an export before shipping it

- Dimensions match exactly what the manifest declares (`Image.open(path).size`).
- Format is what the filename claims (`Image.open(path).format`).
- For favicon-family exports: transparency present where expected, absent
  (solid bg) for `apple-touch-icon.png` specifically.
- For multi-frame formats (`.ico`): re-open and confirm the *actual* frame
  count and sizes, not just that the save call didn't raise.

See `Validation.md` for the full pre-ship checklist beyond just exports.
