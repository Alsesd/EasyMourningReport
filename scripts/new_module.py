#!/usr/bin/env python3
"""Scaffold a frontend feature module under frontend/src/modules/."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES_DIR = ROOT / "frontend" / "src" / "modules"


def normalize_name(name: str) -> tuple[str, str]:
    """Return a safe directory slug and a TypeScript identifier."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    if not slug:
        raise ValueError("Module name must contain at least one letter or number.")
    identifier = "".join(part.capitalize() for part in slug.split("-"))
    if identifier[0].isdigit():
        identifier = f"Module{identifier}"
    return slug, identifier


def scaffold(name: str, title: str, *, root: Path = MODULES_DIR) -> Path:
    """Create a feature module skeleton without overwriting an existing module."""
    slug, identifier = normalize_name(name)
    target = root / slug
    if target.exists():
        raise FileExistsError(f"Module already exists: {target}")

    target.mkdir(parents=True)
    for directory in ("pages", "components", "tests"):
        (target / directory).mkdir()

    ts_title = json.dumps(title, ensure_ascii=False)
    (target / "module.tsx").write_text(
        f"""/** Feature entry metadata. */

export const {identifier}Module = {{
  id: {json.dumps(slug)},
  title: {ts_title},
  basePath: {json.dumps('/' + slug)},
}} as const;
""",
        encoding="utf-8",
    )
    (target / "api.ts").write_text(
        f"""/** Feature-owned API calls. */

export const {identifier}Api = {{
  // Add typed endpoint functions here.
}} as const;
""",
        encoding="utf-8",
    )
    (target / "i18n.ts").write_text(
        f"""/** Feature-localized strings. */

export const {identifier}Messages = {{
  title: {ts_title},
  loading: "Loading…",
}} as const;
""",
        encoding="utf-8",
    )
    (target / "tests" / "module.test.ts").write_text(
        f"""import {{ describe, expect, it }} from "vitest";
import {{ {identifier}Module }} from "../module";

describe("feature module scaffold", () => {{
  it("exposes its module metadata", () => {{
    expect({identifier}Module.id).toBe({json.dumps(slug)});
  }});
}});
""",
        encoding="utf-8",
    )
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="Module name, e.g. inventory or reports")
    parser.add_argument("--title", help="Human-readable module title")
    args = parser.parse_args()
    try:
        target = scaffold(args.name, args.title or args.name.replace("-", " ").title())
    except (ValueError, FileExistsError) as exc:
        parser.error(str(exc))
    print(f"Created module scaffold: {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
