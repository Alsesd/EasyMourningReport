"""Permissions reserved for transport orders. Assign them to roles in «Користувачі → Ролі»."""

from app.core.modules import Permission

CREATE = "transport.orders.create"
VIEW_ALL = "transport.orders.view_all"
MANAGE = "transport.orders.manage"

PERMISSIONS = (
    Permission(CREATE, "Замовлення транспорту", "organisation",
               "Створювати замовлення транспорту від імені своєї організації й бачити їхній статус."),
    Permission(VIEW_ALL, "Перегляд усіх замовлень транспорту", "platform",
               "Бачити замовлення транспорту всіх організацій."),
    Permission(MANAGE, "Обробка замовлень транспорту", "platform",
               "Приймати замовлення й змінювати їхній статус."),
)
