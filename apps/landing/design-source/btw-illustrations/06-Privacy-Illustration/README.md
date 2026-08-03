# Privacy Illustration — v1.0

Three-zone explainer illustration for Beyond the Wall's core privacy promise,
built as a reusable module (not a one-off picture) — the same components and
tokens compose the landing page, docs, and presentation decks without
redrawing anything.

## The three messages (no text required)

1. **Cameras remain with their owners.** They're drawn on the left, each with
   its own translucent field-of-view — visible, but never connected to
   anything else in the scene.
2. **Video never leaves the camera or reaches the cloud.** A crossed-out
   video-stream glyph sits between the phone and the cloud on the right —
   not a crossed-out *internet* icon, specifically a crossed-out *video*
   icon, because the point is narrower than "no connectivity."
3. **BTW works from geometry and local computation only.** The phone in the
   center is the largest object in the frame, drawn on top of the ambient
   camera rays (aware of them, not wired to them), flanked by GPS/Compass/
   Route badges and a "local processing" shield+checkmark badge.

## Files

```
privacy.svg           800x400   master — horizontal 3-zone composition
privacy-mobile.svg     750x1000  portrait — re-composed vertical stack
privacy-square.svg     700x700   1:1 — re-composed vertical stack
privacy-dark.svg       800x400   identical to privacy.svg (see note below)
components/
  Camera.svg    32x32
  Phone.svg     180x340
  Cloud.svg     96x64
  NoUpload.svg  64x64
  Shield.svg    44x44
  Route.svg     100x40
  GPS.svg       40x40
  Compass.svg   48x48
  FOV.svg       136x130
manifest/
  privacy.json
previews/
  privacy-dark.png    800x400  direct render on its native dark canvas
  privacy-light.png   880x480  same illustration framed on a light page
README.md
```

## Why `privacy-mobile.svg` and `privacy-square.svg` aren't crops

The master composition is a wide 2:1 horizontal narrative (cameras → phone →
cloud, left to right). Cropping that into a portrait or square frame would
cut off one of the three zones entirely — usually the cameras, since they
sit at the far left. Both variants are re-composed instead: the same nine
components, the same tokens, the same narrative, restacked vertically
(cameras on top with their FOV rotated to face downward toward the phone,
phone in the middle, cloud at the bottom). This mirrors the decision already
made for `04-Hero-Illustration/hero-mobile.svg`.

## `privacy-dark.svg` — why it's identical to `privacy.svg`

The brief's color palette fixes the background at `#0F172A` — there is no
separate light-mode recolor defined anywhere in this asset family, the same
situation as the hero illustration. Rather than silently omit the
requested file, `privacy-dark.svg` ships as an explicit, honestly-labeled
copy of `privacy.svg` (see the comment at the top of the file), so that
tooling selecting assets by a `-dark` filename suffix has something to find.
If a real second palette is wanted later, that's a design decision for
someone to make deliberately — not something to improvise here.

## Component-list discrepancy (flagging, not hiding)

The brief's prose lists nine components as *Camera, Phone, GPS Pin, Compass,
Route, Cloud, No Upload, Warning, Shield* — but the folder tree it proposes
lists `components/FOV.svg` and no `components/Warning.svg`. This build
follows the folder tree literally: `FOV` ships as its own reusable component
(it's actually reused three times per composition), and the warning triangle
is drawn inline inside each composition file instead of as a standalone
component (it appears once per layout and doesn't need independent reuse).
If a standalone `Warning.svg` is genuinely wanted, it's a five-minute
addition — just say so.

## Tokens

```json
{
  "bg": "#0F172A",
  "neutral": "#F8FAFC",
  "primary": "#3B82F6",
  "success": "#22C55E",
  "danger": "#EF4444"
}
```

Same token names as `04-Hero-Illustration` and `05-Icons`. `danger` is the
token already introduced for the icon system's error/incident states — reused
here for the "no video upload" slash rather than inventing a new red. No
yellow "warning" token appears anywhere in this asset family; the brief's own
color list for Privacy doesn't include it.

## Animation (CSS only, per the brief)

Each file embeds one inline `<style>` block — no JavaScript:

- Every camera's FOV ray pulses opacity between 0.14 and 0.30 on a 4-second
  loop, staggered 0.6s apart across the three cameras so they don't move in
  lockstep.
- The phone breathes gently — `scale(1) → scale(1.015)` on a 3-second loop.
- The red "no video upload" slash is explicitly excluded from any animation
  class and never moves, exactly as the brief specifies — it's the one
  certain, static fact in an otherwise softly-alive scene.

These are pure CSS `@keyframes`, degrade gracefully to a static first frame
anywhere that doesn't run them (the PNG previews, print, email), and don't
touch the "no filter / no script" rule shared with the rest of the system.

## Compliance

Every file: `viewBox`, `width`, `height`, `role="img"`, `aria-hidden="true"`.
Only the five tokens above are used anywhere. No `filter`, `<image>`, or
`<script>`. Max `<g>` nesting is 2. All under the ≤8KB budget from the wider
BTW SVG spec (largest file is `privacy-dark.svg` at ~6.2KB, master
`privacy.svg` at ~5.8KB).

## Usage

```jsx
<PrivacyIllustration />      {/* privacy.svg */}
<Camera />
<FOV />
```

Same import pattern as `04-Hero-Illustration`'s components — self-contained
`.svg` files with their own `viewBox`, droppable into any React/HTML context
without modification.
