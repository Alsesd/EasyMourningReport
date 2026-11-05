"""The transport scaffold is installed and guarded by its permissions."""

from app.platform.registry import get_registry


def test_module_is_registered_with_its_permissions():
    registry = get_registry()
    assert "transport" in [m.name for m in registry]
    assert {"transport.orders.create", "transport.orders.view_all", "transport.orders.manage"} <= registry.codes()
    assert registry.permission("transport.orders.create").scope == "organisation"
