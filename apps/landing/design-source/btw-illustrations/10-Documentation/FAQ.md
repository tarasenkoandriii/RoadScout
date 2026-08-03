# FAQ

## "Why don't Hero/Privacy/OG share one Phone component?"

Because they're drawn at genuinely different scales for genuinely different
canvases (Hero's phone is 160×320 on a 1200×900 stage; Privacy's is
180×340 on an 800×400 stage) — forcing one shared file would mean either
distorting one composition to match the other's proportions, or adding
scale-override parameters to a component that was simpler without them.
See `Architecture.md`'s "Dependency direction" section for the full
reasoning, and `Components.md` for both variants side by side.

## "Why does `X-dark.svg` exist if it's identical to the default file?"

Hero, Privacy, and Open Graph all have this pattern
(`hero` has no `-dark` variant because the master already *is* dark and
that's the only one that exists; Privacy and OG both ship an explicit
`*-dark.svg` that's a byte-for-byte-equivalent copy of their default). The
brief for each of those asset families specifies exactly one background
color with no second dark palette to diverge from — the `-dark` file
exists, honestly labeled as identical (there's a comment at the top of
each explaining this), for any pipeline/CDN that selects assets by a
`-dark` filename suffix convention. It's not a mistake or leftover
duplicate — see each asset's own `.md` file in this folder for the exact
reasoning.

## "Why does Open Graph have a real `-light` variant but Hero/Privacy don't?"

Hero and Privacy are always-dark, always-in-app illustrations — there's
never a context where the surrounding page is light and the illustration
needs to match it, because the product itself is dark-themed everywhere
these appear. Open Graph is different: it's a standalone thumbnail that
gets embedded by *other people's* pages, some of which are light-themed,
so a genuine light recolor has real value there in a way it doesn't for
the other two.

## "Where's the standalone Warning.svg component?"

It doesn't exist yet. Warning is drawn inline in both
`06-Privacy-Illustration/privacy.svg` and
`07-OpenGraph/master/og-image.svg`, with matching (but not file-shared)
geometry, because each was the first and (so far) only place that
particular composition needed it. See `Architecture.md`'s "Known gaps" and
`Components.md`'s Warning entry for the exact inline path data to start
from if you need to promote it to a real file.

## "Can I just resize any component by changing its `width`/`height`?"

Depends on the component. Some are truly parametric (ScanCone's `radius`/
`angle` genuinely reshape the cone correctly at any value); others have
geometry hand-fitted to one specific size (Hand is fitted to wrap the
Hero-variant Phone specifically — see `Components.md`'s Hand entry — and
won't wrap the Privacy-variant Phone correctly without re-deriving its
offsets). Check the specific component's constraints in `Components.md`
before assuming a resize "just works."

## "Why do some icons bake in a fixed color instead of using `currentColor`?"

Because for a handful of icons, the color *is* the information — a
`status/success.svg` rendered in an arbitrary parent-set red would
communicate the opposite of what it's supposed to. Most icons (the
majority) do use `currentColor` and inherit their color from context; the
exceptions are documented per-icon in `05-Icons/docs/DesignRules.md` and
summarized in `Design-Tokens.md`'s "States" table.

## "Why 8px grid for illustrations but 24px for icons?"

An 8px grid on a 24-unit icon canvas leaves only 3 usable grid points
total (0, 8, 16, 24) — too coarse to be useful at that scale. Icons
follow the common industry convention of their own 24px-canvas system
instead. See `Design-System.md`.

## "The original spec says all coordinates are multiples of 8, but some of the actual numbers aren't. Bug?"

Not introduced by this project — that inconsistency exists in the
*founding specification itself* (the phone's `y=420`, several camera
positions, the 28px marker size). Explicit numbers given in a brief are
treated as more authoritative than that brief's own general grid rule when
the two conflict, and the numbers were kept exactly as specified rather
than "corrected." See `Hero.md`.

## "Why does the favicon use solid fills instead of the stroke style everything else uses?"

Because a stroke thin enough to look right at 512px would be far too thin
to survive being scaled down to a 16px favicon, and a stroke thick enough
to survive at 16px would look absurdly heavy at 512px. Solid fills sidestep
the problem entirely — a filled shape doesn't thin out and disappear the
way a stroke does. Full reasoning and pixel-level proof (ASCII maps at
16px and 32px) in `Favicon.md` and `08-Favicon/README.md`.

## "Do I need to run every check in `Validation.md` for a one-line color fix?"

At minimum: confirm the new color exists in `Design-Tokens.md`'s token
set, confirm no forbidden elements were accidentally introduced, and
re-render to confirm nothing else shifted. The full geometric bounding-box
check matters most for anything touching *positions* — a pure color swap
with no coordinate change is lower-risk, but "lower-risk" isn't "zero
checks."

## "Something in this documentation contradicts something in an asset folder's own README. Which wins?"

The asset folder's own detailed README/manifest is the more specific,
more authoritative source for that asset's specifics — this
`10-Documentation/` folder's per-asset files (`Hero.md`, `Privacy.md`,
etc.) are summaries pointing back to them, and could in principle drift out
of sync if the underlying asset changes and this summary isn't updated
alongside it. If you find a real contradiction, that's a documentation bug
in this folder — fix the summary to match the source of truth, not the
other way around.
