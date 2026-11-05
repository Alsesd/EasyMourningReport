"""Permissions the reports module adds to the platform."""

from app.core.modules import Permission

SUBMIT = "reports.submit"
REVIEW = "reports.review"
CATALOG_MANAGE = "reports.catalog.manage"
SETTINGS_MANAGE = "reports.settings.manage"

PERMISSIONS = (
    Permission(SUBMIT, "Заповнення звіту", "organisation",
               "Заповнювати й надсилати щомісячний звіт своєї організації."),
    Permission(REVIEW, "Перегляд звітів", "platform",
               "Бачити звіти всіх організацій і зведення, вивантажувати Excel, блокувати й розблоковувати звіти."),
    Permission(CATALOG_MANAGE, "Товари й ціни", "platform",
               "Додавати товари, змінювати ціни, імпортувати з Excel."),
    Permission(SETTINGS_MANAGE, "Налаштування звітів організацій", "platform",
               "Вмикати режим «По розрахунку» для окремих організацій."),
)

AUDIT_ACTIONS = (
    "збережено звіт",
    "надіслано звіт",
    "заблоковано звіт",
    "розблоковано звіт",
    "додано товар",
    "масово додано товари",
    "змінено товар",
    "змінено ціну товару",
    "архівовано товар",
    "відновлено товар",
    "видалено товар",
    "змінено налаштування звітів",
)
