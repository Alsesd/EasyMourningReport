"""Architecture guard: application composition imports from public package facades."""

import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
APPLICATION_ENTRY = ROOT / "app" / "main.py"
ROUTES = ROOT / "app" / "routes"

PUBLIC_FACADES = {"app.core", "app.db", "app.db.repositories", "app.services"}


def implementation_import(module: str | None) -> bool:
    if not module:
        return False
    if module.startswith("app.core.") and module not in PUBLIC_FACADES:
        return True
    if module.startswith("app.db.models."):
        return True
    if module in {
        "app.db.base",
        "app.db.session",
        "app.db.backup",
        "app.db.bootstrap",
    }:
        return True
    if module.startswith("app.db.repositories.") and module != "app.db.repositories":
        return True
    if module.startswith("app.services."):
        return True
    return False


class FacadeImportArchitectureTests(unittest.TestCase):
    def test_application_entry_and_route_modules_use_public_facades(self):
        sources = [APPLICATION_ENTRY, *sorted(ROUTES.rglob("*.py"))]
        violations = []
        for path in sources:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    module = node.module
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        if implementation_import(alias.name):
                            violations.append(
                                f"{path.relative_to(ROOT)}:{node.lineno}: import {alias.name}"
                            )
                    continue
                else:
                    continue
                if implementation_import(module):
                    violations.append(
                        f"{path.relative_to(ROOT)}:{node.lineno}: from {module} import ..."
                    )

        self.assertEqual(
            violations,
            [],
            "Application entrypoints/routes must depend on public facades, not internals:\n"
            + "\n".join(violations),
        )


if __name__ == "__main__":
    unittest.main()
