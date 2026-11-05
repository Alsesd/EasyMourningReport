"""Permission codes owned by the platform itself."""

from app.core.modules import Permission

ORGANISATIONS_MANAGE = "platform.organisations.manage"
USERS_MANAGE = "platform.users.manage"
ROLES_MANAGE = "platform.roles.manage"
AUDIT_VIEW = "platform.audit.view"
SYSTEM_MANAGE = "platform.system.manage"
ORG_USERS_MANAGE = "org.users.manage"

PLATFORM_PERMISSIONS = (
    Permission(ORGANISATIONS_MANAGE, "Керування організаціями", "platform",
               "Створювати, перейменовувати, архівувати й видаляти організації."),
    Permission(USERS_MANAGE, "Керування всіма користувачами", "platform",
               "Створювати облікові записи в будь-якій організації й призначати ролі."),
    Permission(ROLES_MANAGE, "Керування ролями", "platform",
               "Створювати ролі та визначати, які дозволи вони надають."),
    Permission(AUDIT_VIEW, "Журнал дій", "platform", "Переглядати журнал входів і змін."),
    Permission(SYSTEM_MANAGE, "Системні налаштування", "platform",
               "Резервні копії, стан бази даних і публічний доступ через Cloudflare Tunnel."),
    Permission(ORG_USERS_MANAGE, "Користувачі своєї організації", "organisation",
               "Додавати й вимикати облікові записи своєї організації та призначати їм ролі."),
)

# Built-in roles. "platform_admin" and "org_admin" always hold every permission of their scope.
PLATFORM_ADMIN = "platform_admin"
ORG_ADMIN = "org_admin"
STORE = "store"
ALL_OF_SCOPE = {PLATFORM_ADMIN: "platform", ORG_ADMIN: "organisation"}
BUILT_IN_ROLES = (
    (PLATFORM_ADMIN, "Адміністратор", "platform"),
    (ORG_ADMIN, "Адміністратор організації", "organisation"),
    (STORE, "Магазин", "organisation"),
)
