package platform

import "legkyi/internal/core"

const (
	OrganisationsManage = "platform.organisations.manage"
	UsersManage         = "platform.users.manage"
	RolesManage         = "platform.roles.manage"
	AuditView           = "platform.audit.view"
	SystemManage        = "platform.system.manage"
	OrgUsersManage      = "org.users.manage"

	PlatformAdmin = "platform_admin"
	StoreRole     = "store"
)

// AllOfScope: these built-in roles always hold every permission of their scope.
var AllOfScope = map[string]string{PlatformAdmin: core.ScopePlatform}

// Module describes the platform with the same contract as feature modules.
var Module = core.Module{
	Name:  "platform",
	Title: "Платформа",
	Permissions: []core.Permission{
		{Code: OrganisationsManage, Label: "Керування підрозділами", Scope: "platform",
			Description: "Створювати, перейменовувати, архівувати й видаляти підрозділи."},
		{Code: UsersManage, Label: "Керування всіма користувачами", Scope: "platform",
			Description: "Створювати облікові записи в будь-якому підрозділі й призначати ролі."},
		{Code: RolesManage, Label: "Керування ролями", Scope: "platform",
			Description: "Створювати ролі та визначати, які дозволи вони надають."},
		{Code: AuditView, Label: "Журнал дій", Scope: "platform",
			Description: "Переглядати журнал входів і змін."},
		{Code: SystemManage, Label: "Системні налаштування", Scope: "platform",
			Description: "Резервні копії, стан бази даних і публічний доступ через Cloudflare Tunnel."},
		{Code: OrgUsersManage, Label: "Користувачі свого підрозділу", Scope: "organisation",
			Description: "Додавати й вимикати облікові записи свого підрозділу та призначати їм ролі."},
	},
	AuditActions: []string{
		"вхід", "невдалий вхід", "вихід", "змінено власний пароль",
		"додано підрозділ", "змінено підрозділ", "архівовано підрозділ",
		"відновлено підрозділ", "видалено підрозділ",
		"додано користувача", "змінено користувача", "змінено пароль користувача", "видалено користувача",
		"додано роль", "змінено роль", "видалено роль",
		"завантажено бекап", "увімкнено публічний доступ", "вимкнено публічний доступ",
		"додано ключ доступу", "видалено ключ доступу", "оновлення програми", "завершено сеанс користувача",
	},
}
