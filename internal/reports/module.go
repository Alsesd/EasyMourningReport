package reports

import "legkyi/internal/core"

const (
	Submit         = "reports.submit"
	Review         = "reports.review"
	CatalogManage  = "reports.catalog.manage"
	SettingsManage = "reports.settings.manage"
)

var Module = core.Module{
	Name:  "reports",
	Title: "Звіти",
	Permissions: []core.Permission{
		{Code: Submit, Label: "Заповнення звіту", Scope: "organisation",
			Description: "Заповнювати й надсилати щомісячний звіт свого підрозділу."},
		{Code: Review, Label: "Перегляд звітів", Scope: "platform",
			Description: "Бачити звіти всіх підрозділів і зведення, вивантажувати Excel, блокувати й розблоковувати звіти."},
		{Code: CatalogManage, Label: "Товари й ціни", Scope: "platform",
			Description: "Додавати товари, змінювати ціни, імпортувати з Excel."},
		{Code: SettingsManage, Label: "Налаштування звітів підрозділів", Scope: "platform",
			Description: "Вмикати режим «По розрахунку» для окремих підрозділів."},
	},
	AuditActions: []string{
		"збережено звіт", "надіслано звіт", "заблоковано звіт", "розблоковано звіт",
		"додано товар", "масово додано товари", "змінено товар", "змінено ціну товару",
		"архівовано товар", "відновлено товар", "видалено товар", "змінено налаштування звітів",
	},
	DefaultGrants:     map[string][]string{"store": {Submit}},
	Seed:              SeedDemo,
	Overview:          Overview,
	OrganisationUsage: UsagePerOrganisation,
}
