# Naming — 05-Icons

## File naming

- All files: lowercase, kebab-case, `.svg`. Example: `camera-fov.svg`, not
  `CameraFOV.svg` — except the `hero/` family, which keeps PascalCase
  (`Phone.svg`, `ScanCone.svg`) because it mirrors the existing component
  names already used in `04-Hero-Illustration/components/` and in React
  imports (`<ScanCone />`).
- No spaces, no underscores, no version suffixes in filenames
  (`camera-fixed.svg`, never `camera_fixed_v2.svg`).
- A family's own name is never repeated as a filename prefix inside its own
  folder: `camera/camera-fixed.svg` is correct (the file already reads
  "camera-fixed" because that's the actual icon name); a hypothetical
  `detection/detection-car.svg` would be wrong — it's just `detection/car.svg`.
  The one deliberate exception is the `camera/` family, where every icon
  name legitimately starts with "camera-" (camera-fixed, camera-ptz, …)
  because that prefix is part of the concept, not the folder.

## Sprite symbol IDs

Because `car.svg`, `route.svg`, `success.svg` etc. exist as short, plain
names in their own folders but must coexist in one flat sprite, sprite
symbol IDs are namespaced by category to avoid collisions — **except**
`core/`, which stays unprefixed since those four names are the product's
foundational vocabulary and are guaranteed unique:

| Folder | File | Sprite symbol id |
|---|---|---|
| `core/` | `open.svg` | `icon-open` |
| `core/` | `warning.svg` | `icon-warning` |
| `camera/` | `camera-fixed.svg` | `icon-camera-fixed` |
| `detection/` | `car.svg` | `icon-detection-car` |
| `navigation/` | `route.svg` | `icon-navigation-route` |
| `privacy/` | `shield.svg` | `icon-privacy-shield` |
| `status/` | `warning.svg` | `icon-status-warning` |
| `ui/` | `settings.svg` | `icon-ui-settings` |

Note `core/warning.svg` → `icon-warning` and `status/warning.svg` →
`icon-status-warning` are deliberately different symbols: the core one is
a generic hazard triangle used inline in text/labels; the status one is a
filled circular badge used in list rows and status chips. Same concept,
different visual job — see `docs/DesignRules.md`.

The full, generated id list lives in `manifest/icons.json`
(`icons[].spriteSymbol`) — treat that file as the source of truth, not
this table.

## Complete file list by family

**core/** — open, point, detect, warning

**camera/** — camera-fixed, camera-ptz, camera-offline, camera-online,
camera-private, camera-public, camera-ai, camera-radar, camera-fov,
camera-record

**detection/** — car, truck, bus, motorcycle, bicycle, pedestrian, police,
checkpoint, speed-camera, incident

**navigation/** — route, route-fixed, route-ai, destination,
current-position, compass, gps, direction, location

**privacy/** — privacy, anonymous, encrypted, cloud-off, local-processing,
delete, shield

**status/** — success, warning, error, offline, online, loading, sync,
search

**ui/** — menu, settings, filter, layers, map, fullscreen, zoom-in,
zoom-out, download, share, info, help

**hero/** — Phone, Hand, ScanCone, CameraMarker, CameraFOV, RadarArc,
CompassRing, Cloud, Arrow, Pin

**brand/** — logo, logo-mark, favicon, app-icon, apple-touch-icon,
mask-icon

## Tags

`manifest/icons.json` carries a small `tags` array per flat icon (synonyms
a designer or search box is likely to type — e.g. `location.svg` is tagged
`pin`, `map-marker`). Add to these tags rather than renaming files; file
names are the stable contract, tags are the fuzzy search layer.
