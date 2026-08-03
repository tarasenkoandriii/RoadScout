#!/usr/bin/env python3
"""
validate.py — automated validation pass for the BTW SVG design system.

Runs every mechanical check documented in 10-Documentation/Validation.md
and SVG-Rules.md against the actual shipped files, and produces a report.
Zero third-party dependencies (see schema_validator.py for why).

Usage:
    python3 validate.py [path-to-merged_project-root]

Exit code 0 if everything passes, 1 if anything fails.
"""
import sys, os, re, json, glob
import xml.etree.ElementTree as ET
from schema_validator import validate as schema_validate

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."

FORBIDDEN_ELEMENTS = ["<filter", "<script", "<image", "<foreignObject"]
REQUIRED_ATTRS = ['viewBox="', 'role="img"']

SIZE_BUDGETS_KB = {
    "04-Hero-Illustration": 20,
    "06-Privacy-Illustration": 8,
    "05-Icons": 2,       # per-icon, not per-folder
    "08-Favicon": 1,     # master SVG only
    "07-OpenGraph": 30,  # master SVG, pre-SVGO budget
}

report = {"errors": [], "warnings": [], "passed": [], "summary": {}, "legacy": []}

MASK_ICON_FILENAME_PATTERN = re.compile(r"(mask-icon|safari-pinned-tab)\.svg$")
MASK_ICON_EXCEPTION_COLOR = "#000000"


def is_legacy_reference(rel_path):
    """03-SVG-Component-Library is the project's first-generation component
    library, explicitly superseded by 04-Hero-Illustration and
    06-Privacy-Illustration and kept only as a historical reference (see
    that folder's own README). It predates every compliance rule this
    validator checks and was never meant to be brought up to the current
    standard retroactively — findings inside it are reported separately as
    accepted legacy debt, not regressions requiring action."""
    return rel_path.startswith("03-SVG-Component-Library" + os.sep)


def err(category, msg):
    report["errors"].append(f"[{category}] {msg}")

def warn(category, msg):
    report["warnings"].append(f"[{category}] {msg}")

def ok(category, msg):
    report["passed"].append(f"[{category}] {msg}")


# ---------------------------------------------------------------------------
# 1. Manifest schema validation
# ---------------------------------------------------------------------------
def validate_manifests():
    schema_dir = os.path.join(ROOT, "manifest", "schemas")
    asset_schema = json.load(open(os.path.join(schema_dir, "asset-manifest.schema.json")))
    tokens_schema = json.load(open(os.path.join(schema_dir, "tokens.schema.json")))
    project_schema = json.load(open(os.path.join(schema_dir, "project.schema.json")))

    manifest_dir = os.path.join(ROOT, "manifest")
    if not os.path.isdir(manifest_dir):
        err("manifest", f"centralized manifest/ folder not found at {manifest_dir}")
        return

    schema_map = {
        "project.json": project_schema,
        "tokens.json": tokens_schema,
    }
    for f in sorted(glob.glob(os.path.join(manifest_dir, "*.json"))):
        name = os.path.basename(f)
        schema = schema_map.get(name, asset_schema)
        try:
            data = json.load(open(f))
        except json.JSONDecodeError as e:
            err("manifest", f"{name}: invalid JSON ({e})")
            continue
        errors = schema_validate(data, schema)
        if errors:
            for e in errors:
                err("manifest", f"{name}: {e}")
        else:
            ok("manifest", f"{name} conforms to its schema")

    # per-folder detailed manifests: valid JSON only (they carry extra fields
    # beyond the common schema on purpose, see 10-Documentation/Manifest.md)
    for f in sorted(glob.glob(os.path.join(ROOT, "0*-*/manifest/*.json"))):
        try:
            json.load(open(f))
            ok("manifest", f"{os.path.relpath(f, ROOT)} is valid JSON")
        except json.JSONDecodeError as e:
            err("manifest", f"{os.path.relpath(f, ROOT)}: invalid JSON ({e})")


# ---------------------------------------------------------------------------
# 2. SVG structural checks
# ---------------------------------------------------------------------------
def max_g_nesting(content):
    depth = maxdepth = 0
    for tok in re.findall(r'<(/?)g[ >]', content):
        if tok == '':
            depth += 1
            maxdepth = max(maxdepth, depth)
        else:
            depth -= 1
    return maxdepth


def get_allowed_colors():
    tokens_path = os.path.join(ROOT, "manifest", "tokens.json")
    if not os.path.exists(tokens_path):
        return None
    data = json.load(open(tokens_path))
    return {c["hex"].upper() for c in data.get("colors", {}).values()}


def validate_svgs():
    allowed_colors = get_allowed_colors()
    svg_files = sorted(glob.glob(os.path.join(ROOT, "**", "*.svg"), recursive=True))
    n_checked = 0
    for f in svg_files:
        rel = os.path.relpath(f, ROOT)
        legacy = is_legacy_reference(rel)
        content = open(f, encoding="utf-8").read()
        n_checked += 1

        def flag(category, msg):
            if legacy:
                report["legacy"].append(f"[{category}] {msg}")
            else:
                err(category, msg)

        try:
            ET.fromstring(content)
        except ET.ParseError as e:
            flag("svg-xml", f"{rel}: not well-formed XML ({e})")
            continue

        for bad in FORBIDDEN_ELEMENTS:
            if bad in content:
                flag("svg-forbidden", f"{rel}: contains forbidden element {bad}")

        for attr in REQUIRED_ATTRS:
            if attr not in content:
                flag("svg-required-attrs", f"{rel}: missing required {attr.rstrip('=' + chr(34))}")

        if 'aria-hidden="true"' not in content and 'aria-label=' not in content and 'aria-labelledby=' not in content:
            if legacy:
                report["legacy"].append(f"[svg-a11y] {rel}: no aria-hidden/aria-label/aria-labelledby found")
            else:
                warn("svg-a11y", f"{rel}: no aria-hidden/aria-label/aria-labelledby found")

        depth = max_g_nesting(content)
        if depth > 2:
            flag("svg-nesting", f"{rel}: <g> nesting depth {depth} exceeds max of 2")

        ids = re.findall(r'id="([^"]+)"', content)
        dupes = {x for x in ids if ids.count(x) > 1}
        if dupes:
            flag("svg-duplicate-id", f"{rel}: duplicate id(s) {dupes}")

        if allowed_colors:
            used = set(re.findall(r'#[0-9A-Fa-f]{6}', content))
            used = {c.upper() for c in used}
            disallowed = used - allowed_colors
            # documented exception: Safari mask-icon / pinned-tab files are
            # required BY THE PLATFORM to be pure black, regardless of the
            # brand palette — see 08-Favicon/README.md and
            # 10-Documentation/Favicon.md.
            if MASK_ICON_FILENAME_PATTERN.search(rel):
                disallowed -= {MASK_ICON_EXCEPTION_COLOR}
            if disallowed:
                flag("svg-color", f"{rel}: uses colors outside the token set: {disallowed}")

    ok("svg-scan", f"{n_checked} SVG files scanned")


# ---------------------------------------------------------------------------
# 3. File size budgets
# ---------------------------------------------------------------------------
def validate_sizes():
    for folder, budget_kb in SIZE_BUDGETS_KB.items():
        folder_path = os.path.join(ROOT, folder)
        if not os.path.isdir(folder_path):
            warn("size-budget", f"{folder} not found, skipping size check")
            continue
        budget_bytes = budget_kb * 1024
        if folder == "05-Icons":
            targets = glob.glob(os.path.join(folder_path, "*", "*.svg"))
            # sprites/ and previews/ are aggregation files (60 icons bundled
            # into one file) — the per-icon 2KB budget was never meant to
            # apply to them; a 60-icon sprite is naturally much larger than
            # any single icon, that's not a regression.
            targets = [t for t in targets if os.sep + "sprites" + os.sep not in t
                       and os.sep + "previews" + os.sep not in t]
        elif folder == "08-Favicon":
            targets = glob.glob(os.path.join(folder_path, "master", "*.svg"))
        elif folder == "07-OpenGraph":
            targets = glob.glob(os.path.join(folder_path, "master", "og-image.svg"))
        else:
            targets = glob.glob(os.path.join(folder_path, "*.svg")) + \
                      glob.glob(os.path.join(folder_path, "*", "*.svg"))
        over = []
        for t in targets:
            size = os.path.getsize(t)
            if size > budget_bytes:
                over.append((os.path.relpath(t, ROOT), size))
        if over:
            for path, size in over:
                err("size-budget", f"{path}: {size}B exceeds {folder}'s {budget_kb}KB budget")
        elif targets:
            ok("size-budget", f"{folder}: all {len(targets)} checked file(s) within {budget_kb}KB budget")


# ---------------------------------------------------------------------------
# Run everything, print report
# ---------------------------------------------------------------------------
def main():
    validate_manifests()
    validate_svgs()
    validate_sizes()

    report["summary"] = {
        "passed": len(report["passed"]),
        "warnings": len(report["warnings"]),
        "errors": len(report["errors"]),
        "legacy": len(report["legacy"]),
    }

    print("=" * 70)
    print("BTW SVG Design System — Validation Report")
    print("=" * 70)
    print(f"Root: {os.path.abspath(ROOT)}")
    print()
    print(f"PASSED:            {report['summary']['passed']}")
    print(f"WARNINGS:          {report['summary']['warnings']}")
    print(f"ERRORS:            {report['summary']['errors']}")
    print(f"LEGACY (accepted): {report['summary']['legacy']}")
    print()

    if report["errors"]:
        print("-- ERRORS (need action) --")
        for e in report["errors"]:
            print(" ", e)
        print()
    if report["warnings"]:
        print("-- WARNINGS --")
        for w in report["warnings"]:
            print(" ", w)
        print()
    if report["legacy"]:
        print("-- LEGACY / ACCEPTED (03-SVG-Component-Library, historical reference only, not fixed) --")
        for l in report["legacy"]:
            print(" ", l)
        print()

    print("-- PASSED (sample) --")
    for p in report["passed"][:20]:
        print(" ", p)
    if len(report["passed"]) > 20:
        print(f"  ... and {len(report['passed']) - 20} more")

    return 0 if not report["errors"] else 1


if __name__ == "__main__":
    sys.exit(main())
