# Usage — 05-Icons

## Quick picks

- Dropping one icon into markup? Use the standalone file directly (inline
  `<svg>`, `<img src="...svg">`, or a bundler's SVG-as-component loader).
- Rendering many icons in one page/app? Use `sprites/sprite.svg` once and
  reference icons by id with `<use>` — one network request instead of N.
- Need a downloadable/reviewable overview? `previews/contact-sheet.svg`
  (vector) or `previews/icons-light.png` / `icons-dark.png` (raster).

## Sizing (16 / 20 / 24 / 32 / 48 / 64 / 96 / 128)

Every flat icon's source is `viewBox="0 0 24 24"` with no hard-coded
pixel identity beyond a 24px default — so any of the recommended sizes is
just an attribute:

```html
<!-- inline -->
<svg viewBox="0 0 24 24" width="16" height="16">...</svg>
<svg viewBox="0 0 24 24" width="128" height="128">...</svg>

<!-- CSS, e.g. in a design system that sizes by font-size -->
.icon-sm  { width: 16px; height: 16px; }
.icon-lg  { width: 64px;  height: 64px; }

<!-- sprite <use>, sized per-instance -->
<svg width="20" height="20"><use href="sprites/sprite.svg#icon-camera-fixed"/></svg>
<svg width="96" height="96"><use href="sprites/sprite.svg#icon-camera-fixed"/></svg>
```

At 16–20px, a couple of the busier icons (e.g. `ui/settings.svg`,
`navigation/gps.svg`) can look slightly heavy at the default 2px stroke.
If your renderer supports it, drop to 1.5px at small sizes with a CSS
custom property rather than shipping a second file:

```css
.icon { stroke-width: 2; }
.icon--16, .icon--20 { stroke-width: 1.5; }
```

### If you need physical per-size files anyway

Some pipelines (icon fonts, certain design-review tools, PNG export for
non-SVG contexts) do want static per-size assets. Rather than hand-author
608 files, regenerate them on demand with the same renderer used for
`previews/`: for each icon and each size in `manifest/icons.json →
sizes`, render `<svg width={size} height={size} viewBox="0 0 24 24">…`
to PNG (headless Chromium, `resvg`, or `wkhtmltoimage` all work — this
repo's previews were built with `wkhtmltoimage`). That keeps one
hand-authored source of truth per icon and treats every sized export as a
disposable build artifact, not something to hand-maintain.

## Sprite usage

Two sprite files, same 60 flat icons (`core/camera/detection/navigation/
privacy/status/ui` — **not** `hero/` or `brand/`, which aren't meant to be
swapped at uniform icon size):

- **`sprite.svg`** — plain `<symbol>` per icon, no titles. Fetch once,
  reference everywhere. Best for apps that inject it once (e.g. hidden at
  the top of `<body>`, or loaded and cached as a static asset).
- **`sprite-symbol.svg`** — identical symbols, each with a `<title>`
  containing the icon id, for contexts that inline the sprite directly
  in HTML and want a baseline accessible name per icon out of the box.

```html
<!-- 1. include the sprite once (hidden), inline or via fetch+inject -->
<div style="display:none">
  <!-- contents of sprites/sprite.svg -->
</div>

<!-- 2. reference by id anywhere, as many times as you like -->
<svg width="24" height="24" class="icon" xmlns:xlink="http://www.w3.org/1999/xlink">
  <use href="#icon-camera-online" xlink:href="#icon-camera-online"/>
</svg>
```

**Compatibility note:** include both `href` and `xlink:href` on every
`<use>`. Current evergreen browsers only need plain `href`, but some
WebKit-based renderers (older Safari, some headless/embedded WebKit
builds) only resolve `xlink:href`. Shipping both costs nothing and avoids
a silent blank icon on those engines — this is exactly the failure mode
we hit and fixed while building this sprite, so it's not a theoretical
concern.

Symbol ids follow `icon-{category}-{name}`, except `core/`, which is bare
(`icon-open`, not `icon-core-open`) — see `docs/Naming.md` for the full
id table and the reasoning.

## React

```jsx
// generic wrapper around any flat icon file, imported as a URL/raw string
// by your bundler's SVG loader (exact import syntax depends on your setup)
import CameraFixed from '05-Icons/camera/camera-fixed.svg';

<CameraFixed width={20} height={20} className="text-slate-300" />
```

```jsx
// sprite-based icon component
function Icon({ id, size = 24, ...props }) {
  return (
    <svg width={size} height={size} {...props}>
      <use href={`/sprites/sprite.svg#icon-${id}`} />
    </svg>
  );
}

<Icon id="camera-online" size={16} />
<Icon id="ui-settings" />
```

Hero components (`hero/Phone.svg`, `hero/ScanCone.svg`, …) map the same
way they already do in `04-Hero-Illustration`:

```jsx
<Phone />
<ScanCone />
<CameraMarker />
```

## Build pipeline (svgo.config.json)

`svgo.config.json` at the root optimizes the flat icon families
(`core/camera/detection/navigation/privacy/status/ui`) for shipping:
collapses redundant path precision, strips editor cruft, keeps
`viewBox`/`role`/`aria-hidden` intact (those are required, see
`docs/DesignRules.md`), and strips explicit `width`/`height` so the
optimized output is purely `viewBox`-sized and CSS-friendly.

```
svgo --config svgo.config.json -f core -o dist/core
svgo --config svgo.config.json -f camera -o dist/camera
# ...repeat per flat-icon folder
```

Run this over `hero/` and `brand/` **without** `removeDimensions`
(comment it out or pass `--no-*` overrides) — those two families rely on
concrete pixel dimensions (favicon/app-icon platform requirements, hero
component composition math), unlike the flat icons.

## Regenerating previews

`previews/contact-sheet.svg`, `previews/icons-light.png`, and
`previews/icons-dark.png` are generated, not hand-maintained. If icons are
added/renamed, regenerate all three from `manifest/icons.json` rather than
hand-editing — the contact sheet's layout and labels are derived directly
from that manifest.
