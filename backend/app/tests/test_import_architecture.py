"""Guard the intended modular application architecture."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "backend" / "app"
APPLICATION_ENTRY = APP / "main.py"
PACKAGE_ENTRY = APP / "__main__.py"
FORBIDDEN_FACADES = {"app.core", "app.db", "app.services", "app.db.repositories"}


def imported_module(node: ast.AST) -> str | None:
    if isinstance(node, ast.ImportFrom):
        return node.module
    if isinstance(node, ast.Import):
        return node.names[0].name if node.names else None
    return None


def test_application_modules_import_concrete_owners():
    violations = []
    for path in sorted(p for p in APP.rglob("*.py") if "tests" not in p.parts):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            module = imported_module(node)
            if module in FORBIDDEN_FACADES:
                violations.append(
                    f"{path.relative_to(ROOT)}:{node.lineno}: import from package facade {module}"
                )

    assert violations == [], (
        "Import from the module that owns the symbol instead of a package facade:\n"
        + "\n".join(violations)
    )


def test_package_initializers_do_not_define_dynamic_facades():
    package_entries = [
        APP / "core" / "__init__.py",
        APP / "db" / "__init__.py",
        APP / "services" / "__init__.py",
        APP / "db" / "repositories" / "__init__.py",
    ]
    for path in package_entries:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        dynamic_exports = [
            node.name
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name in {"__getattr__", "__dir__"}
        ]
        assert not dynamic_exports, f"{path.relative_to(ROOT)} still defines {dynamic_exports}"
        assert "_EXPORTS" not in source and "_DEFERRED" not in source


def test_main_is_composition_only():
    tree = ast.parse(APPLICATION_ENTRY.read_text(encoding="utf-8"))
    imported = {
        imported_module(node)
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
    }
    assert "app.routes" in imported
    assert "app.core.lifecycle" in imported
    assert "app.core.http_errors" in imported
    package_tree = ast.parse(PACKAGE_ENTRY.read_text(encoding="utf-8"))
    package_imports = {
        imported_module(node)
        for node in ast.walk(package_tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
    }
    assert "app.db.session" in package_imports
    assert "app.db" not in package_imports
    assert not any(module and module.startswith("app.routes.admin.") for module in imported)
