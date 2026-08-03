# Hero — `04-Hero-Illustration/`

## Purpose

The landing page's primary illustration: a hand holding a phone that is
scanning the environment and detecting nearby cameras. The core visual
argument for the whole product in one image — geometry and awareness,
without any actual connection to the cameras themselves.

## Sizes

| Variant | ViewBox | Aspect | Layout |
|---|---|---|---|
| `hero.svg` (master) | 1200×900 | 4:3 | full composition, source of truth |
| `hero-desktop.svg` | 1600×900 | 16:9 | master, centered, extended skyline |
| `hero-wide.svg` | 2160×900 | 2.4:1 | master, centered, wider margins |
| `hero-square.svg` | 900×900 (crop `150 0 900 900`) | 1:1 | direct crop of the master canvas |
| `hero-mobile.svg` | 750×1000 | 3:4 | **re-composed**, not cropped — see below |

## Structure

```
04-Hero-Illustration/
├── components/     Phone, Hand, ScanCone, CameraMarker, CameraFOV (see Components.md)
├── hero/            the 5 variants above
├── preview/         hero-dark.png, hero-light.png
├── manifest/
│   └── hero.json
└── README.md
```

## Components used

Phone, Hand, ScanCone, CameraMarker (×3, one per detected camera),
CameraFOV (×3). Full parameter reference in `Components.md`.

## Canonical geometry (master frame, 1200×900)

- Phone: `x=280 y=420 w=160 h=320 rx=24`
- Scan origin: `(360, 420)` — top-center of the phone
- Scan cone: `angle=80°, radius=520, start=-40°, end=+40°`
- Cameras: `camera-1 (610,280)` success, `camera-2 (760,360)` warning,
  `camera-3 (540,170)` success — marker size 28×28
- Camera FOV: `angle=24°, length=110, stroke-width=2`

**These exact numbers came from the founding specification and are kept
exactly as given**, even though several of them (`420`, `610`, `540`,
`170`, `28`) are not multiples of 8 despite that same specification's own
"all coordinates are multiples of 8" rule. Explicit numbers in a brief take
precedence over a general grid rule when the two conflict — see
`Design-System.md`.

## Why `hero-mobile.svg` is a re-composition, not a crop

The master is a wide 4:3 scene with the phone positioned left-of-center and
cameras spread to the upper right. Cropping that into a 3:4 portrait frame
would either cut off the cameras entirely or shrink the phone to
illegibility. Instead, `hero-mobile.svg` keeps the phone and hand at their
original absolute size and re-derives the camera cluster and scan-cone
radius specifically so nothing clips in the taller, narrower frame — same
components, same tokens, different arrangement.

## Export

Each variant is a single self-contained SVG (no raster export step for
Hero itself — `09-Previews/light/hero.png` and `dark/hero.png` are preview
renders, not shipped production assets). File sizes: 2.8–3.5KB per variant,
against a ≤20KB budget (`Performance.md`).

## Acceptance criteria

- [x] Scales without quality loss (pure vector, no raster content)
- [x] Only the 5 documented tokens (`bg/primary/success/warning/neutral`)
      appear anywhere
- [x] No `filter`/`<image>`/`<script>` anywhere
- [x] Max `<g>` nesting of 2, everywhere
- [x] Every variant under the 20KB budget
- [x] `viewBox`/`width`/`height`/`role="img"`/`aria-hidden="true"` on every
      file

See `04-Hero-Illustration/README.md` for the full detailed writeup,
including the CSS-animation-free rationale and the reasoning behind the
intentional scan-cone bleed past the canvas edge — worth reading before
touching the geometry again. (The bug history worth knowing about — a
flipped connector arrow, a 30px vertical misalignment, a 3-level
group-nesting violation, all caught by rendering and measuring rather than
by reading source — belongs to `Privacy.md`/`06-Privacy-Illustration`'s own
build, not this one; see that document instead.)
