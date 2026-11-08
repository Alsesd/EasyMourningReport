package reports

import (
	"context"

	"legkyi/internal/core"
)

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
			Description: "Заповнювати й надсилати щоденний звіт свого підрозділу."},
		{Code: Review, Label: "Перегляд звітів", Scope: "platform",
			Description: "Бачити звіти всіх підрозділів за дні й місяці і зведення, вивантажувати Excel, блокувати й розблоковувати звіти."},
		{Code: CatalogManage, Label: "Товари й ціни", Scope: "platform",
			Description: "Додавати товари, змінювати ціни, імпортувати з Excel."},
		{Code: SettingsManage, Label: "Налаштування звітів підрозділів", Scope: "platform",
			Description: "Вмикати режим «По розрахунку» для окремих підрозділів."},
	},
	AuditActions: []string{
		"збережено звіт", "надіслано звіт", "заблоковано звіт", "розблоковано звіт",
		"збережено звіт за день", "надіслано звіт за день", "заблоковано звіт за день", "розблоковано звіт за день",
		"додано товар", "масово додано товари", "змінено товар", "змінено ціну товару",
		"архівовано товар", "відновлено товар", "видалено товар", "змінено налаштування звітів",
	},
	DefaultGrants:     map[string][]string{"store": {Submit}},
	Seed:              SeedDemo,
	Overview:          Overview,
	Dashboard:         Dashboard,
	Routes:            routes,
	Catalog:           catalog,
	OrganisationUsage: UsagePerOrganisation,
}

// catalog offers the products that appear in new report forms (active, not archived) to other modules, which only
// see id and name (prices stay with the reports).
func catalog(ctx context.Context, q core.Querier) ([]core.CatalogProduct, error) {
	list, err := LoadProducts(ctx, q, "WHERE active = 1 AND archived = 0")
	if err != nil {
		return nil, err
	}
	hist, err := LoadHistory(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]core.CatalogProduct, 0, len(list))
	for _, p := range list {
		item := core.CatalogProduct{ID: p.ID, Name: p.Name}
		if cents, err := LatestPrice(HistoryOf(hist, p)); err == nil && cents > 0 {
			item.PriceCents = &cents
		}
		out = append(out, item)
	}
	return out, nil
}
