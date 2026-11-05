#!/usr/bin/env python3
"""Scaffold a feature module: ``backend/app/modules/<name>/`` and ``frontend/src/modules/<name>/``.

The generated module already follows the platform contract (permissions, router, page, nav
entry and tests). Register it afterwards in ``backend/app/modules/__init__.py`` and
``frontend/src/modules/index.ts``; the script prints the exact lines.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND_MODULES = ROOT / "backend" / "app" / "modules"
FRONTEND_MODULES = ROOT / "frontend" / "src" / "modules"


def normalize_name(name: str) -> tuple[str, str, str]:
    """Return a Python package name, a URL/permission slug, and a TypeScript identifier."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    if not slug or not slug[0].isalpha():
        raise ValueError("Module name must start with a letter, e.g. inventory or fleet-orders.")
    package = slug.replace("-", "_")
    identifier = "".join(part.capitalize() for part in slug.split("-"))
    return package, slug, identifier[0].lower() + identifier[1:]


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.lstrip("\n"), encoding="utf-8")


def scaffold(
    name: str,
    title: str,
    *,
    backend_root: Path = BACKEND_MODULES,
    frontend_root: Path = FRONTEND_MODULES,
) -> tuple[Path, Path]:
    """Create both halves of a module without overwriting anything."""
    package, slug, ident = normalize_name(name)
    backend, frontend = backend_root / package, frontend_root / slug
    for target in (backend, frontend):
        if target.exists():
            raise FileExistsError(f"Module already exists: {target}")
    py_title, ts_title = json.dumps(title, ensure_ascii=False), json.dumps(title, ensure_ascii=False)
    view = f"{package}.view"

    _write(backend / "__init__.py", f'''
"""{title} module."""

from app.core.modules import Module
from app.modules.{package}.permissions import PERMISSIONS
from app.modules.{package}.routes import router

module = Module(
    name="{package}",
    title={py_title},
    router=router,
    permissions=PERMISSIONS,
    models=(),
)
''')
    _write(backend / "permissions.py", f'''
"""Permissions of the {title} module."""

from app.core.modules import Permission

VIEW = "{view}"

PERMISSIONS = (
    Permission(VIEW, {py_title}, "platform", "Відкривати розділ «{title}»."),
)
''')
    _write(backend / "schemas.py", f'''
"""{title} DTOs."""

from app.core.schemas import DTO


class {ident[0].upper() + ident[1:]}StatusDTO(DTO):
    message: str
''')
    status_dto = f"{ident[0].upper() + ident[1:]}StatusDTO"
    _write(backend / "routes.py", f'''
"""{title} endpoints."""

from fastapi import APIRouter, Depends

from app.modules.{package}.permissions import VIEW
from app.modules.{package}.schemas import {status_dto}
from app.platform.accounts.access import Principal, require

router = APIRouter(prefix="/{slug}", tags=[{py_title}])


@router.get("/status", response_model={status_dto})
def module_status(_: Principal = Depends(require(VIEW))) -> {status_dto}:
    return {status_dto}(message={py_title})
''')
    _write(backend / "models.py", f'''
"""{title} tables. List every table class in ``models=`` in ``__init__.py``."""
''')
    _write(backend / "tests" / "__init__.py", "\n")
    _write(backend / "tests" / f"test_{package}_module.py", f'''
from app.modules.{package} import module


def test_module_declares_its_permissions():
    assert module.name == "{package}"
    assert [p.code for p in module.permissions] == ["{view}"]
''')

    _write(frontend / "permissions.ts", f'''
/** Permission codes of the {title} module (mirrors the backend). */
export const PERM = {{ view: "{view}" }} as const;
''')
    _write(frontend / "api.ts", f'''
/** {title} API owned by this module. */

import {{ api }} from "@/platform/api/client";

export const {ident}Api = {{
  status: () => api.get<{{ message: string }}>("/api/v1/{slug}/status"),
}};
''')
    _write(frontend / "pages" / "IndexPage.tsx", f'''
import {{ useQuery }} from "@tanstack/react-query";
import {{ {ident}Api }} from "../api";

export default function IndexPage() {{
  const {{ data }} = useQuery({{ queryKey: [{json.dumps(slug)}, "status"], queryFn: () => {ident}Api.status() }});
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-text-main">{{{ts_title}}}</h1>
      <p className="text-sm text-text-muted">{{data?.message}}</p>
    </div>
  );
}}
''')
    _write(frontend / "module.tsx", f'''
import {{ lazy }} from "react";
import {{ LayoutGrid }} from "lucide-react";
import type {{ AppModule }} from "@/platform/modules";
import {{ PERM }} from "./permissions";

export const {ident}Module: AppModule = {{
  id: {json.dumps(slug)},
  title: {ts_title},
  routes: [{{ path: {json.dumps(slug)}, component: lazy(() => import("./pages/IndexPage")), permissions: [PERM.view] }}],
  nav: [{{ id: {json.dumps(slug)}, to: {json.dumps("/admin/" + slug)}, label: {ts_title}, icon: LayoutGrid, permissions: [PERM.view], order: 40 }}],
}};
''')
    _write(frontend / "module.test.ts", f'''
import {{ describe, expect, it }} from "vitest";
import {{ {ident}Module }} from "./module";

describe("{slug} module", () => {{
  it("guards every route with its permission", () => {{
    expect({ident}Module.routes.every((r) => r.permissions.includes("{view}"))).toBe(true);
  }});
}});
''')
    return backend, frontend


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="Module name, e.g. inventory or fleet-orders")
    parser.add_argument("--title", help="Human-readable (Ukrainian) module title")
    args = parser.parse_args()
    try:
        title = args.title or args.name.replace("-", " ").title()
        backend, frontend = scaffold(args.name, title)
    except (ValueError, FileExistsError) as exc:
        parser.error(str(exc))
    package, slug, ident = normalize_name(args.name)
    print(f"Created {backend.relative_to(ROOT)} and {frontend.relative_to(ROOT)}")
    print("Register it:")
    print(f"  backend/app/modules/__init__.py: from app.modules.{package} import module as {package}  (add to INSTALLED_MODULES)")
    print(f'  frontend/src/modules/index.ts:   import {{ {ident}Module }} from "@/modules/{slug}/module";  (add to installedModules)')
    print("Then grant the new permission to a role under «Користувачі → Ролі».")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
