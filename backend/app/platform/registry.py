"""The installed modules, platform first. Built lazily so modules may import platform code freely."""

from functools import lru_cache

from app.core.modules import ModuleRegistry


@lru_cache(maxsize=1)
def get_registry() -> ModuleRegistry:
    from app.modules import INSTALLED_MODULES
    from app.platform.module import module as platform_module

    return ModuleRegistry([platform_module, *INSTALLED_MODULES])
