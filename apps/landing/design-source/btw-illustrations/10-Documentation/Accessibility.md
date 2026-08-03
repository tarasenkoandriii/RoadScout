# Accessibility

## `role="img"` and `aria-hidden="true"`

Every SVG in this project ships both attributes together. That pairing
looks contradictory at first glance — `role="img"` normally exists to give
assistive technology an accessible name, while `aria-hidden="true"`
removes the element from the accessibility tree entirely — but it's the
correct pattern for **decorative** imagery: the illustration/icon adds
visual meaning a sighted user already gets from surrounding context (a
label, a heading, a caption), and repeating that same information via a
screen-reader-announced image would be redundant, not helpful. `role="img"`
stays in place for tooling/CSS hooks and for the rare case a consumer wants
to override the hidden state for a specific use.

## When to break that default

If an SVG is ever used **non-decoratively** — as the *only* source of some
piece of information, with no adjacent text conveying the same thing —
switch it to:

```xml
<svg role="img" aria-label="Camera detected 12 meters northeast">
  <!-- no aria-hidden -->
  ...
</svg>
```

or, if the meaningful content is longer than a short label:

```xml
<svg role="img" aria-labelledby="title1 desc1">
  <title id="title1">Camera detected</title>
  <desc id="desc1">A camera was detected 12 meters northeast of your current position.</desc>
  ...
</svg>
```

None of the assets currently shipped in this project need this — every
icon, illustration, and favicon here is decorative/supplementary to text
that exists alongside it. If a future use case changes that (an icon
becomes the *only* indicator of a status, with no text label anywhere
nearby), that specific instance needs a real `aria-label`, not just the
decorative default copied out of habit.

## Contrast

- **Neutral-on-bg** (`#F8FAFC` on `#0F172A`) — the most common pairing
  across every illustration family — has a contrast ratio well above the
  WCAG AA threshold for both normal and large text/graphics.
- **Primary, success, warning, danger on `bg`** — all four accent tokens
  were chosen to read clearly against the dark background at the opacities
  they're actually used at (0.14–1.0 depending on context); none of them
  are used at an opacity low enough to become a contrast problem for their
  *intended* decorative role. They are not intended to carry text at low
  opacity — if a future design puts text in any of these colors, re-check
  contrast at that specific size/weight rather than assuming the token
  passes by default.
- **Light variants** (Open Graph's `og-image-light.svg`) swap `bg`/`neutral`
  roles rather than introduce new colors — contrast is preserved because
  the same pair that worked dark-on-light also works light-on-dark; it's
  the same two tokens, not two new ones that would need separate
  verification.

## Icons specifically

`05-Icons`' flat icon family uses `currentColor` for the default, non-
semantic icons — meaning contrast is the *consuming app's* responsibility,
not something baked into the icon file. Status/semantic icons
(`status/success.svg`, `camera/camera-online.svg`, etc.) bake in a fixed
token color specifically because the color carries meaning that shouldn't
be overridden by a parent's `color` — see `Design-Tokens.md`'s "States"
section.

## What this project does not currently have

No formal accessibility audit (screen-reader testing, automated contrast
tooling run against every shipped file) has been performed as part of this
documentation pass — the guidance above reflects the design decisions made
during each asset's construction, not the output of a dedicated
accessibility review. If one is needed, it's real, well-scoped future
work; don't treat this document as evidence that one already happened.
