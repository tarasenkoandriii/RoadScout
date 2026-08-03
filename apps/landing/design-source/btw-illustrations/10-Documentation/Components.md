# Components — API Reference

Every entry below follows the same template (the project's Appendix B
"Component API Reference"): name, purpose, viewBox, input parameters,
design tokens used, constraints, usage example, compatible components,
version. These are the 12 components this project's specification
designates as mandatory to document.

A note before the reference: several of these components exist as **more
than one file** at different scales (Phone exists at two different sizes;
Cloud exists in two different illustration families). That's intentional —
see `Architecture.md`'s "Dependency direction" section for why this project
doesn't force one shared file across every scale. Each variant is listed
separately below.

---

## Phone

**Purpose:** the central object in both the hero illustration and the
privacy explainer — the user's own device, always drawn larger than
anything else in its scene, always with a status dot and faint screen
scan-lines suggesting active local computation.

Two sized variants exist:

### Phone (Hero variant)

- **File:** `04-Hero-Illustration/components/Phone.svg`
- **ViewBox:** `0 0 160 320`
- **Parameters:** `width=160, height=320, radius=24, screenPadding=12`
- **Tokens:** stroke = `neutral` (#F8FAFC), stroke-width 4 (screen: 2),
  status dot = `success` (#22C55E)
- **Constraints:** corner radius must stay proportional if resized (don't
  scale width/height independently without also scaling `radius`); the
  status dot's position (`cx=124, cy=36`) is relative to this specific
  160×320 box.
- **Compatible with:** ScanCone (origin = phone's top-center), Hand (wraps
  this exact box), CameraMarker/CameraFOV (positioned around it)
- **Version:** 2.1.0 (see `04-Hero-Illustration/manifest/hero.json`)

```xml
<svg viewBox="0 0 160 320" width="160" height="320" role="img" aria-hidden="true">
  <rect x="2" y="2" width="156" height="316" rx="24" fill="none" stroke="#F8FAFC" stroke-width="4"/>
  <rect id="screen" x="14" y="14" width="132" height="292" rx="12" fill="none" stroke="#F8FAFC" stroke-width="2"/>
  <circle cx="124" cy="36" r="6" fill="#22C55E"/>
</svg>
```

### Phone (Privacy variant)

- **File:** `06-Privacy-Illustration/components/Phone.svg`
- **ViewBox:** `0 0 180 340`
- **Parameters:** `width=180, height=340, radius=24, screenPadding=14`
- **Why a different size:** the privacy composition's canvas (800×400) and
  its 3-zone layout call for a slightly larger, slightly differently-
  proportioned phone than the hero's 1200×900 canvas does. Same visual
  language, different scale — not an inconsistency, a deliberate per-scene
  fit.
- **Compatible with:** GPS/Compass/Route/Shield badges (positioned around
  it), FOV cones (converge toward it)
- **Version:** 1.0.0 (see `06-Privacy-Illustration/manifest/privacy.json`)

**JSON manifest excerpt** (from `06-Privacy-Illustration/manifest/privacy.json`):
```json
{ "name": "Phone", "file": "components/Phone.svg", "size": [180, 340] }
```

---

## Hand

- **File:** `04-Hero-Illustration/components/Hand.svg`
- **Purpose:** the hand holding the Phone in the hero illustration only —
  no other asset family uses Hand (Open Graph's brief explicitly excludes
  it; Privacy never included it).
- **ViewBox:** `0 0 224 288`
- **Parameters:** `gripWidth=224, gripHeight=288`, sized to wrap a 160×320
  Phone positioned at a `(32,148)` offset within this box.
- **Tokens:** stroke = `neutral`, stroke-width 4, round caps/joins
- **Constraints:** this is geometrically fitted to the Hero Phone
  specifically (160×320) — it will not wrap the Privacy Phone (180×340)
  without re-deriving the wrist/thumb/finger offsets. Don't reuse this file
  as-is against a differently-sized phone.
- **Compatible with:** Phone (Hero variant) only
- **Version:** 2.1.0

---

## ScanCone

- **File:** `04-Hero-Illustration/components/ScanCone.svg`
- **Purpose:** the phone's own outgoing "scanning" beam — a translucent
  wedge rising from the phone's top edge, always extending past the
  phone's own silhouette (never contained inside it).
- **ViewBox:** `0 0 1040 520`
- **Parameters:** `originX=520, originY=520, radius=520, startAngle=-40,
  endAngle=40, color=primary, opacity=0.30`
- **Angle convention:** 0° = straight up, clockwise positive. `start =
  centerAngle - angle/2`, `end = centerAngle + angle/2` — this convention
  is reused (generalized to aim at an arbitrary point, not just "up") by
  `07-OpenGraph`'s camera FOV cones; see `Architecture.md`.
- **Tokens:** fill = `primary` (#3B82F6), opacity 0.30 (a second, fainter
  0.15-opacity layer at a different radius is used in the actual hero
  composition for a glow effect — that layering isn't in this standalone
  component file, it's specific to `hero.svg`'s composition).
- **Constraints:** radius 520 deliberately overshoots the hero canvas's own
  height budget at the hero's specific origin point — the cone's tip bleeds
  off the top edge of `hero.svg` on purpose (an intentional "beam extends
  beyond the frame" effect), not a bug. Don't "fix" this by shrinking the
  radius without checking whether the composition using it actually wants
  containment (Privacy's/OG's versions use smaller radii precisely because
  their canvases are shorter and can't afford the same overshoot).
- **Compatible with:** Phone (any variant, aimed from its top-center),
  CameraFOV (same angle convention)
- **Version:** 2.1.0

---

## CameraMarker

- **File:** `04-Hero-Illustration/components/CameraMarker.svg`
- **Purpose:** a detected camera's position on the map/scene — a simple
  colored dot (or drop-pin, see Parameters) indicating a camera exists
  there.
- **ViewBox:** `0 0 28 28`
- **Parameters:** `x=14, y=14` (center, in local coordinates), `color =
  success | warning`, `type = circle | drop`. The shipped default renders
  `type="circle"`; the `drop` alternative path is documented in a comment
  inside the file itself (`M14 2C7.4 2 2 7.4 2 14c0 9 12 20.6 12
  20.6S26 23 26 14C26 7.4 20.6 2 14 2Z`) rather than shipped as a second
  file.
- **Tokens:** `color` is either `success` (#22C55E, camera reachable/known)
  or `warning` (#EAB308, ambiguous/edge case) — never `danger`; a camera
  marker is never itself an error state.
- **Constraints:** 28×28 is the fixed marker size across the hero
  composition (`markerSize` also appears in
  `04-Hero-Illustration/manifest/hero.json → canonicalGeometry.cameras`);
  don't resize a single marker independently of the others in the same
  scene, or the "same distance = same visual weight" convention breaks.
- **Compatible with:** CameraFOV (drawn emanating from the same origin
  point as a marker), ScanCone
- **Version:** 2.1.0

---

## CameraFOV

- **File:** `04-Hero-Illustration/components/CameraFOV.svg`
- **Purpose:** a camera's field-of-view indicator — two thin rays fanning
  out from the camera's position, always drawn in the same "up" convention
  as ScanCone.
- **ViewBox:** `0 0 110 110`
- **Parameters:** `origin=(55,110), angle=24, length=110, color=neutral,
  stroke-width=2`. Two rays at ±`angle/2` from the aim direction.
- **Constraints:** the standalone file's aim direction is fixed at "up."
  `07-OpenGraph` needed cameras aimed at an arbitrary point (the phone,
  from three different camera positions around it) and generalized this
  formula (`aim_angle_from_up`) rather than editing this file — see
  `Architecture.md`. If you need a FOV aimed anywhere other than straight
  up, use the generalized formula, not this file directly.
- **Compatible with:** CameraMarker (same origin point), ScanCone (same
  angle convention)
- **Version:** 2.1.0

---

## Route

- **File:** `06-Privacy-Illustration/components/Route.svg`
- **Purpose:** a computed-locally path indicator — a shallow curve with
  start/end dots, used wherever the composition needs to show "a route was
  calculated," never an actual literal map/street path.
- **ViewBox:** `0 0 100 40`
- **Parameters:** `width=100, height=40`
- **Tokens:** stroke = `neutral`, stroke-width 3, round caps; dots filled
  `neutral`
- **Constraints:** designed to be stretched horizontally via a non-uniform
  `scale(sx, 1)` transform when a composition needs a wider route than
  100 units (both `06-Privacy-Illustration/privacy.svg` and
  `07-OpenGraph/master/og-image.svg` do this) — stretching vertically
  distorts the curve's proportions and isn't recommended.
- **Compatible with:** Phone (route typically passes under it), Warning
  (typically positioned just before the route's start point)
- **Version:** 1.0.0

---

## Compass

- **File:** `06-Privacy-Illustration/components/Compass.svg`
- **Purpose:** an "orientation/heading" accent badge — ambient detail
  reinforcing "this app knows direction," not a functional compass widget.
- **ViewBox:** `0 0 48 48`
- **Parameters:** `size=48`
- **Tokens:** stroke = `neutral` (ring, 2.5 width), needle fill = `neutral`,
  hub = `bg`-filled with a `neutral` stroke ring
- **Constraints:** the needle is a single diamond shape (not two
  differently-colored halves the way a "real" compass needle often is) —
  deliberately simplified since this is a small accent badge, not a
  standalone navigation icon (compare `05-Icons/navigation/compass.svg`,
  which is a different, currentColor-based file for the icon system).
- **Compatible with:** Phone (positioned as a nearby badge), GPS, Shield
- **Version:** 1.0.0

---

## GPS

- **File:** `06-Privacy-Illustration/components/GPS.svg`
- **Purpose:** "GPS Pin" — a map-pin silhouette representing on-device
  location awareness.
- **ViewBox:** `0 0 40 40`
- **Parameters:** `size=40`
- **Tokens:** stroke = `neutral`, stroke-width 3
- **Constraints:** this is the *badge* version (small, used adjacent to
  Phone) — not the same file as `05-Icons/navigation/location.svg` (the
  flat, `currentColor`-based icon-system equivalent) or
  `04-Hero-Illustration/components/... Pin.svg`-style hero asset (a
  larger, standalone map-pin component in the hero asset family). Three
  conceptually related but differently-scaled/differently-purposed files
  exist across this project; don't assume they're interchangeable.
- **Compatible with:** Phone, Route (start of a Phone→GPS→Route→Warning
  flow, connected with simple arrow connectors in both Privacy and OG)
- **Version:** 1.0.0

---

## Cloud

**Purpose:** "the internet / a remote server" — always drawn at reduced
opacity (0.55) to read as distant/external, in contrast to the fully-opaque
Phone (the user's own device). Two files exist:

### Cloud (Privacy variant)

- **File:** `06-Privacy-Illustration/components/Cloud.svg`
- **ViewBox:** `0 0 96 64`
- **Parameters:** `width=96, height=64`
- **Tokens:** stroke = `neutral`, stroke-width 4, opacity 0.55
- **Version:** 1.0.0

### Cloud (Hero-family asset, reused from 03-SVG-Component-Library)

- **File:** `04-Hero-Illustration/components/Cloud.svg` (and originally
  `03-SVG-Component-Library/.../components/Cloud.svg`)
- **ViewBox:** `0 0 120 80`
- **Constraints:** larger, slightly different curve than the Privacy
  variant — this one predates the Privacy illustration and was carried
  forward unmodified into the Hero asset family's own component set rather
  than redrawn, per `04-Hero-Illustration/README.md`'s own note on reusing
  what already worked.
- **Version:** 1.0.0 (unversioned in the original 03- library; treat as
  1.0.0 going forward)

**Compatible with:** NoUpload (Privacy's crossed-out-video glyph sits
between Phone and Cloud specifically)

---

## Shield

- **File:** `06-Privacy-Illustration/components/Shield.svg`
- **Purpose:** the "local processing / verified" badge — a shield outline
  with a checkmark inside, combining what the original brief listed as two
  separate ideas (a green checkmark, and a shield) into one component,
  since both were meant to sit in the same place conveying the same
  message. See `Privacy.md`'s note on this consolidation.
- **ViewBox:** `0 0 44 44`
- **Parameters:** `size=44`
- **Tokens:** outline = `success` (#22C55E), stroke-width 3; checkmark =
  `success`, same stroke-width
- **Constraints:** always paired with the "Local processing" text caption
  in the compositions that use it (Privacy) — the shield alone, without
  that label, reads ambiguously as generic "security," not specifically
  "computed on this device."
- **Compatible with:** Phone (always positioned adjacent to it)
- **Version:** 1.0.0

---

## Warning

- **File:** **none yet** — drawn inline in both
  `06-Privacy-Illustration/privacy.svg` and
  `07-OpenGraph/master/og-image.svg`, with matching but not file-shared
  geometry. This is a real, flagged gap in the shared component library —
  see `Architecture.md`'s "Known gaps" section.
- **Purpose:** a simple warning triangle + exclamation mark, used as the
  end-state of a Phone→GPS→Route→Warning flow (an alert the app might
  surface, drawn as the last link in that chain, not a live warning about
  anything specific).
- **Reference geometry** (as it currently appears, inline, in
  `06-Privacy-Illustration/privacy.svg`):
  ```xml
  <g id="warning" fill="none" stroke="#F8FAFC" stroke-width="2.4"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M275 333.5 L288 356.5 H262 Z"/>
    <line x1="275" y1="343.16" x2="275" y2="348.68"/>
  </g>
  <circle cx="275" cy="352.97" r="1.1" fill="#F8FAFC"/>
  ```
  (Coordinates above are absolute, as positioned inside `privacy.svg`'s own
  800×400 canvas — extract and re-center around `(0,0)` before treating
  this as a standalone component.)
- **Tokens:** stroke/fill = `neutral`
- **Constraints/todo:** if a third consumer needs this shape, promote it to
  a real `components/Warning.svg` rather than copying the inline geometry a
  third time — that's the point at which "drawn inline twice" stops being
  a reasonable shortcut and starts being duplicated maintenance.
- **Compatible with:** Route (positioned just after it in the flow), GPS
- **Version:** unversioned (no standalone file exists to version yet)

---

## Logo

- **File:** `05-Icons/brand/logo-mark.svg` (icon-only mark);
  `05-Icons/brand/logo.svg` (mark + "Beyond the Wall" wordmark lockup)
- **Purpose:** the brand mark — a shield outline containing a translucent
  scan-wedge and a solid dot, symbolizing "protective awareness." This
  exact shape is rescaled and reused at every scale in the project: as-is
  at 64×64 (brand), rescaled to 512×512 with solid fills replacing the
  strokes (`08-Favicon`), and rescaled to a small corner accent inline in
  `07-OpenGraph`.
- **ViewBox:** `0 0 64 64` (logo-mark); `0 0 340 64` (full lockup with
  wordmark text)
- **Parameters:** none (this is a fixed mark, not a parametric generator —
  unlike Phone/ScanCone/etc., there's no "resize the shield's proportions"
  knob; you scale the whole file uniformly)
- **Tokens:** outline = `neutral`, wedge = `neutral` at opacity 0.28, dot =
  `neutral` (Favicon's rescaled version instead uses `primary` for the
  shield fill, `bg` for the wedge, and `neutral` for the dot — see
  `Favicon.md` for why the color roles change at that scale)
- **Constraints:** `logo.svg`'s wordmark is set with an SVG `<text>`
  element (`font-family="Arial, Helvetica, sans-serif"`), not converted to
  outlines. That's fine for previews and contexts that can guarantee a
  system sans-serif is available; convert to path outlines in a design
  tool before shipping it anywhere that can't guarantee the font renders
  identically everywhere (see `05-Icons/docs/DesignRules.md`'s note on
  this same tradeoff).
- **Compatible with:** appears standalone (brand contexts), or as a small
  accent inline in a larger composition (Open Graph's left panel, next to
  the "BTW" wordmark text)
- **Version:** 1.0.0 (`05-Icons` brand family)

---

## Summary table

| Component | File(s) | ViewBox | Primary token |
|---|---|---|---|
| Phone (Hero) | 04/components/Phone.svg | 160×320 | neutral |
| Phone (Privacy) | 06/components/Phone.svg | 180×340 | neutral |
| Hand | 04/components/Hand.svg | 224×288 | neutral |
| ScanCone | 04/components/ScanCone.svg | 1040×520 | primary |
| CameraMarker | 04/components/CameraMarker.svg | 28×28 | success/warning |
| CameraFOV | 04/components/CameraFOV.svg | 110×110 | neutral |
| Route | 06/components/Route.svg | 100×40 | neutral |
| Compass | 06/components/Compass.svg | 48×48 | neutral |
| GPS | 06/components/GPS.svg | 40×40 | neutral |
| Cloud (Privacy) | 06/components/Cloud.svg | 96×64 | neutral @ 0.55 |
| Cloud (Hero) | 04/components/Cloud.svg | 120×80 | neutral |
| Shield | 06/components/Shield.svg | 44×44 | success |
| Warning | *inline only* | — | neutral |
| Logo | 05/brand/logo-mark.svg | 64×64 | neutral |
