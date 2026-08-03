# Visual Checklist — Open Graph

Manual QA to run before shipping a change to any file in this folder. This
is a checklist for a human (or an agent with actual eyes on a render) to
work through — it is not automated.

## Composition

- [ ] Left panel reads, top to bottom: logo mark + "BTW", "Beyond the Wall",
      "AI Camera Awareness", "Privacy-first Navigation" — exactly 4 lines,
      no more.
- [ ] Right panel contains: phone, scan-cone, 3 cameras, their FOV cones,
      a route, a warning glyph, a small compass accent — and nothing else
      (no Hand, no skyline, no extra decoration).
- [ ] Phone is the visually largest object in the right panel.
- [ ] The phone's scan-cone visibly extends past the phone's own silhouette
      (it shouldn't look contained inside the phone's outline).
- [ ] The three camera FOV cones visibly cross/overlap somewhere in the
      frame — if they don't intersect at all, the "cameras see the same
      area" idea doesn't land.
- [ ] The route passes under the phone, not through it or above it.
- [ ] The warning glyph sits ahead of (before) the route's start point, not
      floating disconnected from it.
- [ ] Nothing from the right-panel illustration crosses into the left 45%
      text column, and no text baseline collides with the illustration.

## Safe area

- [ ] Nothing meaningful (text, logo, phone, camera markers) sits closer
      than 64px to any of the four edges. Ambient/translucent bleed (the
      scan-cone's tip, a camera FOV's outer edge) is fine to cross this
      line — it's decorative falloff, not content.
- [ ] Re-check safe area specifically after any layout edit — it's the
      thing most likely to silently break when repositioning an element.

## Color & tokens

- [ ] Only the 5 documented tokens appear anywhere in any master file:
      `#0F172A` `#3B82F6` `#22C55E` `#EAB308` `#F8FAFC`.
- [ ] No red/danger color anywhere — nothing in this composition represents
      a blocked or error state, so red shouldn't appear at all.
- [ ] `og-image-light.svg` uses the same 5 tokens with bg/ink roles
      swapped — not a sixth new color.

## Per-variant

- [ ] `og-image.svg` — full composition, dark, matches the description
      above exactly.
- [ ] `og-image-dark.svg` — pixel-identical to `og-image.svg` (diff them if
      unsure; they should produce the same render).
- [ ] `og-image-light.svg` — light background, dark ink, illustration still
      fully legible (check contrast on the translucent scan-cone/FOV
      especially — light backgrounds make low-opacity fills harder to see
      than dark ones, so this is the variant most likely to need an opacity
      bump if it ever looks washed out).
- [ ] `og-image-no-text.svg` — left panel is empty, right-panel illustration
      unchanged from the default.
- [ ] `og-image-minimal.svg` — only logo + phone + scan-cone; cameras,
      route, warning, and compass are all absent.

## Exports

- [ ] `exports/png/og-image.png`, `.../webp/og-image.webp`,
      `.../jpg/og-image.jpg` are all exactly 1200×630.
- [ ] Open each in an actual image viewer (not just a file browser thumbnail)
      — thumbnails sometimes hide compression artifacts that matter at full
      size.
- [ ] JPEG in particular: check the scan-cone's soft translucent edge for
      banding/blocking artifacts — flat gradients are where JPEG compression
      shows up first.

## Social preview mockups

- [ ] Re-render `social-previews/*.png` after any change to the exported
      image or to the title/description copy used in meta tags — they go
      stale silently otherwise.
- [ ] After deploying, run the *real* platform debug tools (linked in
      `docs/Usage.md`) against the live URL — the mockups here approximate
      layout only, they cannot catch a caching issue, a malformed meta tag,
      or a platform-specific crop the mockup didn't anticipate.

## Regressions to specifically re-check after any edit

These are the two mistakes actually made and caught while building this
system's sibling folders (`04-Hero-Illustration`, `06-Privacy-Illustration`)
during development — worth checking here too since the same class of bug is
easy to reintroduce:

- [ ] Any arrow/connector between two elements points the *correct*
      direction and lands on the correct row/column — a flipped sign in the
      direction math produces an arrow that's technically drawn but visually
      wrong, and it's easy to miss without a pixel-level check.
- [ ] `<g>` nesting depth is still ≤2 everywhere (`grep -c '<g'` nested
      inside another `<g>` more than twice, anywhere in the file, is a
      violation) — grouping elements for a transform is an easy way to
      accidentally add a third level.
