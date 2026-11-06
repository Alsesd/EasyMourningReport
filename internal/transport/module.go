// Package transport is the scaffolded transport-orders module (status stub only).
package transport

import "legkyi/internal/core"

const (
	Create  = "transport.orders.create"
	ViewAll = "transport.orders.view_all"
	Manage  = "transport.orders.manage"
)

var Module = core.Module{
	Name:  "transport",
	Title: "Транспорт",
	Permissions: []core.Permission{
		{Code: Create, Label: "Замовлення транспорту", Scope: "organisation",
			Description: "Створювати замовлення транспорту від імені своєї організації й бачити їхній статус."},
		{Code: ViewAll, Label: "Перегляд усіх замовлень транспорту", Scope: "platform",
			Description: "Бачити замовлення транспорту всіх організацій."},
		{Code: Manage, Label: "Обробка замовлень транспорту", Scope: "platform",
			Description: "Приймати замовлення й змінювати їхній статус."},
	},
}
