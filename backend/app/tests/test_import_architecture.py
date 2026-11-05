"""Guard the intended modular application architecture."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "backend" / "app"
APPLICATION_ENTRY = APP / "main.py"
PACKAGE_ENTRY = APP / "__main__.py"
FORBIDDEN_FACADES = {"app.core", "app.db", "app.platform", "app.platform.accounts", "app.platform.audit", "app.platform.system"}


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
        APP / "platform" / "__init__.py",
        APP / "platform" / "accounts" / "__init__.py",
        APP / "platform" / "audit" / "__init__.py",
        APP / "platform" / "system" / "__init__.py",
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


MODULES = APP / "modules"
# The only platform file allowed to know modules exist: it loads the registry lazily.
REGISTRY_LOADER = APP / "platform" / "registry.py"


def _imports(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return [
        (node.lineno, module)
        for node in ast.walk(tree)
        if (module := imported_module(node))
    ]


def test_modules_do_not_import_each_other():
    """A module may use core, db and platform code, never another module's internals."""
    violations = []
    for package in sorted(p for p in MODULES.iterdir() if (p / "__init__.py").is_file()):
        own = f"app.modules.{package.name}"
        for path in sorted(package.rglob("*.py")):
            for lineno, module in _imports(path):
                if module.startswith("app.modules") and not module.startswith(own):
                    violations.append(f"{path.relative_to(ROOT)}:{lineno}: imports {module}")
    assert violations == [], "Modules must stay independent:\n" + "\n".join(violations)


def test_platform_and_core_never_import_modules():
    violations = []
    for folder in ("core", "db", "platform", "routes"):
        for path in sorted((APP / folder).rglob("*.py")):
            if path == REGISTRY_LOADER or "tests" in path.parts:
                continue
            for lineno, module in _imports(path):
                if module.startswith("app.modules"):
                    violations.append(f"{path.relative_to(ROOT)}:{lineno}: imports {module}")
    assert violations == [], "Only app/platform/registry.py may load modules:\n" + "\n".join(violations)
