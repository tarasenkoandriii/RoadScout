# Validation

**Most of this checklist now runs automatically.** `tooling/validate.py`
(dependency-free, pure Python) checks manifest schema conformance, SVG
structural rules, and file-size budgets in one pass — see
`tooling/validation-report.md` for the actual, current output. The
checklist below is still the full picture (including checks the script
doesn't automate yet, like pixel-level geometric regression) and the
reference for what the script *means* by each check it runs.

```bash
cd tooling && python3 validate.py /path/to/merged_project
```

The checklist to run before treating any SVG (or the asset family it
belongs to) as done. Everything here is checkable mechanically — none of
it requires subjective judgment, which is exactly why it's a checklist and
not a design review.

## Per-file checklist

- [ ] **`viewBox` is present and correct** — matches the intended canvas
      exactly (not a leftover from a copy-pasted template).
- [ ] **Coordinates respect the grid** for the asset's family (8px for
      illustrations, 24px canvas for icons) — with the documented exception
      that explicit numbers from a brief win over the general grid rule
      when they conflict (see `Hero.md`).
- [ ] **Only allowed colors appear** — every hex code in the file exists in
      `manifest/tokens.json` for that asset family. Quick check:
      ```bash
      grep -oE '#[0-9A-Fa-f]{6}' file.svg | sort -u
      ```
      then diff that list against the family's allowed set in
      `Design-Tokens.md`.
- [ ] **No forbidden elements** — `filter`, `script`, `<image>`,
      `foreignObject`:
      ```bash
      grep -c 'filter\|<image\|<script\|foreignObject' file.svg   # should print 0
      ```
- [ ] **Required attributes present:** `viewBox`, `width`, `height`,
      `role="img"`, `aria-hidden="true"` (or a real label — see
      `Accessibility.md`).
- [ ] **No duplicate `id`s** within the file, or (for anything entering a
      sprite) across every file sharing that sprite.
- [ ] **Max `<g>` nesting of 2** — check programmatically, don't eyeball
      it; a group-nesting violation is exactly the kind of thing that
      looks fine on casual read and is only obvious once counted:
      ```python
      import re
      content = open("file.svg").read()
      depth = maxdepth = 0
      for tok in re.findall(r'<(/?)g[ >]', content):
          if tok == '': depth += 1; maxdepth = max(maxdepth, depth)
          else: depth -= 1
      assert maxdepth <= 2
      ```
- [ ] **File size under the family's budget** (after SVGO) — see
      `Performance.md`.
- [ ] **Well-formed XML:**
      ```python
      import xml.etree.ElementTree as ET
      ET.parse("file.svg")  # raises on malformed XML
      ```

## Per-element geometric validation (the check that actually catches bugs)

Reading SVG source and confirming it "looks right" is not sufficient —
three real, non-obvious bugs were caught during this project's own
development only by rendering a composition and measuring where its
elements actually landed:

1. Render the SVG to a raster (any renderer — see `Export-Guide.md`).
2. For each named element, define its *expected* bounding box (from the
   coordinates you intended).
3. Measure its *actual* bounding box in the render (a simple
   non-background-pixel scan within a search window works):
   ```python
   from PIL import Image
   def bbox(img_path, x0, y0, x1, y1, bg=(15,23,42), thresh=20):
       im = Image.open(img_path).convert("RGB"); px = im.load()
       minx=miny=maxx=maxy=None
       for y in range(y0,y1):
           for x in range(x0,x1):
               p = px[x,y]
               if abs(p[0]-bg[0])+abs(p[1]-bg[1])+abs(p[2]-bg[2]) > thresh:
                   minx = x if minx is None else min(minx,x)
                   maxx = x if maxx is None else max(maxx,x)
                   miny = y if miny is None else min(miny,y)
                   maxy = y if maxy is None else max(maxy,y)
       return minx, miny, maxx, maxy
   ```
4. Compare expected vs. actual. A mismatch means either the geometry math
   is wrong, or (as happened at least once in this project) a connector's
   *direction* is flipped even though its endpoints are individually
   correct-looking in the source.

## JSON Schema / manifest validation

- [ ] Every manifest in `manifest/` parses as valid JSON.
- [ ] Every manifest conforms to the common schema (`Manifest.md`) —
      `id`, `version` (SemVer), `viewBox`, `components`, `exports`,
      `tokens`, `license` all present with the right types.
- [ ] Every asset-family detailed manifest (`0N-Asset/manifest/*.json`)
      parses as valid JSON, even though it carries additional fields
      beyond the common schema.

## Safe area validation

- [ ] Meaningful content (text, logo, solid markers) doesn't cross the
      asset's documented safe-area margin.
- [ ] Ambient/decorative bleed (a scan-cone's tip, a FOV cone's outer edge)
      crossing that same margin is fine — it's falloff, not information;
      don't flag it as a violation.

## Browser compatibility

- [ ] Renders correctly in Chrome, Firefox, Safari, and Edge — see
      `Browser-Support.md`.
- [ ] Any `<use>` reference includes both `href` and `xlink:href`.

## Pixel-perfect comparison (regression check)

When editing an *existing* asset, render both the before and after
versions and diff them (even a simple perceptual pixel-difference image is
enough) to confirm only the intended change actually changed anything —
this catches accidental shifts in unrelated elements that a manual read of
the diff wouldn't necessarily surface.

## Definition of done for validation

An asset is ready to ship when every box above is checked, its manifest is
updated (`Manifest.md`), and (if applicable) its preview in
`09-Previews/` is regenerated.
