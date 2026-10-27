"""Guard the vertical-slice application architecture."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
APPLICATION_ENTRY = APP / "main.py"
PACKAGE_ENTRY = APP / "__main__.py"
LEGACY_PATHS = {
    "api",
    "db",
    "routes",
    "services",
    "dto.py",
    "core/tailscale.py",
    "core/tunnel.py",
    "core/dependencies.py",
    "core/ui.py",
    "templates",
}
FORBIDDEN_FACADES = {
    "app.api",
    "app.core",
    "app.db",
    "app.dto",
    "app.features",
    "app.routes",
    "app.services",
    "app.core.tailscale",
    "app.core.tunnel",
}


def imported_module(node: ast.AST) -> str | None:
    if isinstance(node, ast.ImportFrom):
        return node.module
    if isinstance(node, ast.Import):
        return node.names[0].name if node.names else None
    return None


def test_legacy_packages_and_shims_are_deleted():
    assert not (APP / "api").exists()
    assert not (APP / "db").exists()
    assert not (APP / "routes").exists()
    assert not (APP / "services").exists()
    assert not (APP / "dto.py").exists()
    assert not (APP / "core" / "tailscale.py").exists()
    assert not (APP / "core" / "tunnel.py").exists()
    assert not (APP / "core" / "dependencies.py").exists()
    assert not (APP / "core" / "ui.py").exists()
    assert not (APP / "templates").exists()


def test_legacy_html_auth_routes_are_deleted():
    from app.main import app

    paths = app.openapi()["paths"]
    assert "/login" not in paths
    assert "/logout" not in paths


def test_application_modules_import_concrete_owners():
    violations = []
    for path in sorted(APP.rglob("*.py")):
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
    package_entries = [APP / "core" / "__init__.py"]
    package_entries.extend(sorted((APP / "features").glob("*/__init__.py")))
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
    assert "app.features.auth.router" in imported
    assert "app.features.products.router" in imported
    assert "app.features.stores.router" in imported
    assert "app.features.reports.router" in imported
    assert "app.features.audit.router" in imported
    assert "app.features.tunnel.router" in imported
    assert "app.core.database" in imported or "app.core.bootstrap" in imported
    assert "app.core.backup" in imported

    package_tree = ast.parse(PACKAGE_ENTRY.read_text(encoding="utf-8"))
    package_imports = {
        imported_module(node)
        for node in ast.walk(package_tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
    }
    assert "app.main" in package_imports
    assert "app.db" not in package_imports


def test_no_circular_dependencies_across_features():
    """Assert strictly zero circular dependencies between any modules in app.features."""
    features_dir = APP / "features"
    modules = {}
    for py_file in features_dir.rglob("*.py"):
        rel = py_file.relative_to(APP).with_suffix("")
        mod_name = "app." + ".".join(rel.parts)
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        deps = set()
        for stmt in tree.body:
            if isinstance(stmt, (ast.Import, ast.ImportFrom)):
                module = imported_module(stmt)
                if module and module.startswith("app.features."):
                    deps.add(module)
        modules[mod_name] = deps

    visited = set()
    rec_stack = set()
    cycle_paths = []

    def dfs(node: str, path: list[str]):
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        for neighbor in sorted(modules.get(node, [])):
            matching = [k for k in modules if k == neighbor or neighbor.startswith(k)]
            target = matching[0] if matching else neighbor
            if target in modules:
                if target not in visited:
                    dfs(target, path)
                elif target in rec_stack:
                    cycle_idx = path.index(target)
                    cycle_paths.append(" -> ".join(path[cycle_idx:] + [target]))

        path.pop()
        rec_stack.remove(node)

    for module in modules:
        if module not in visited:
            dfs(module, [])

    assert not cycle_paths, f"Circular dependencies found across feature modules: {cycle_paths}"


def test_directional_interface_contracts():
    """Audit is a leaf slice; products and stores remain mutually independent."""
    features_dir = APP / "features"
    audit_service_imports = set()
    audit_service_file = features_dir / "audit" / "service.py"
    tree = ast.parse(audit_service_file.read_text(encoding="utf-8"), filename=str(audit_service_file))
    for node in ast.walk(tree):
        mod = imported_module(node)
        if mod and mod.startswith("app.features."):
            parts = mod.split(".")
            if len(parts) >= 3 and parts[2] != "audit":
                audit_service_imports.add(mod)
    assert not audit_service_imports, (
        f"audit.service must be a leaf dependency, but imports: {audit_service_imports}"
    )

    stores_to_products = set()
    for py_file in (features_dir / "stores").rglob("*.py"):
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        for node in ast.walk(tree):
            mod = imported_module(node)
            if mod and mod.startswith("app.features.products"):
                stores_to_products.add(mod)
    assert not stores_to_products, (
        f"stores feature slice must not import products, but found: {stores_to_products}"
    )

    products_to_stores = set()
    for py_file in (features_dir / "products").rglob("*.py"):
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        for node in ast.walk(tree):
            mod = imported_module(node)
            if mod and mod.startswith("app.features.stores"):
                products_to_stores.add(mod)
    assert not products_to_stores, (
        f"products feature slice must not import stores, but found: {products_to_stores}"
    )


def test_tailscale_eliminated():
    assert not (APP / "core" / "tailscale.py").exists()
    assert not (ROOT / "tests" / "test_tailscale.py").exists()

    from app.main import app

    route_paths = app.openapi()["paths"]
    tailscale_routes = [path for path in route_paths if "tailscale" in path.lower()]
    assert not tailscale_routes, f"Obsolete tailscale routes found in app: {tailscale_routes}"

    for path in APP.rglob("*.py"):
        content = path.read_text(encoding="utf-8")
        assert "tailscale" not in content.lower(), (
            f"Residual tailscale reference in {path.relative_to(ROOT)}"
        )


def test_production_code_has_no_imports_from_removed_namespaces():
    forbidden = {"app.api", "app.db", "app.routes", "app.services", "app.dto", "app.core.ui"}
    violations = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            module = imported_module(node)
            if module and any(
                module == namespace or module.startswith(namespace + ".")
                for namespace in forbidden
            ):
                violations.append(
                    f"{path.relative_to(ROOT)}:{node.lineno}: import from removed namespace {module}"
                )
    assert not violations, "Obsolete namespace imports found:\n" + "\n".join(violations)
