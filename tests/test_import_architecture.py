"""Guard the intended application architecture.

HTTP composition may import concrete owners directly; it must not depend on
lazy package facades whose dynamic exports hide the real dependency graph.
"""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPLICATION_ENTRY = ROOT / "app" / "main.py"
PACKAGE_ENTRY = ROOT / "app" / "__main__.py"
ROUTES = ROOT / "app" / "routes"
FORBIDDEN_FACADES = {"app.core", "app.db", "app.services", "app.db.repositories"}


def imported_module(node: ast.AST) -> str | None:
    if isinstance(node, ast.ImportFrom):
        return node.module
    if isinstance(node, ast.Import):
        return node.names[0].name if node.names else None
    return None


def test_entrypoint_and_routes_use_explicit_module_imports():
    sources = [APPLICATION_ENTRY, PACKAGE_ENTRY, *sorted(ROUTES.rglob("*.py"))]
    violations = []
    for path in sources:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            module = imported_module(node)
            if module in FORBIDDEN_FACADES:
                violations.append(
                    f"{path.relative_to(ROOT)}:{node.lineno}: import from facade {module}"
                )

    assert violations == [], (
        "Import from the module that owns the symbol instead of a lazy facade:\n"
        + "\n".join(violations)
    )


def test_main_is_composition_only():
    tree = ast.parse(APPLICATION_ENTRY.read_text(encoding="utf-8"))
    imported = {
        imported_module(node)
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
    }
    assert "app.routes" in imported
    assert "app.db.bootstrap" in imported
    assert "app.db.backup" in imported
    package_tree = ast.parse(PACKAGE_ENTRY.read_text(encoding="utf-8"))
    package_imports = {imported_module(node) for node in ast.walk(package_tree) if isinstance(node, (ast.Import, ast.ImportFrom))}
    assert "app.db.session" in package_imports
    assert "app.db" not in package_imports
    assert not any(module and module.startswith("app.routes.admin.") for module in imported)
