(() => {
    "use strict";

    const normalize = value => String(value || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase().trim().replace(/\s+/g, " ");

    function editProduct(product) {
        return {
            ...product,
            editName: product.name,
            editPrice: (product.price_cents / 100).toFixed(2),
            editActive: Boolean(product.active),
            priceOpen: false,
            saving: false,
            feedback: ""
        };
    }

    function editStore(store) {
        return {
            ...store,
            editName: store.name,
            editLogin: store.login,
            newPassword: "",
            saving: false,
            passwordSaving: false
        };
    }

    window.adminApp = function adminApp() {
        return {
            loading: true,
            message: "",
            messageKind: "ok",
            query: "",
            products: [],
            stores: [],
            newProductOpen: false,
            newStoreOpen: false,
            creatingProduct: false,
            creatingStore: false,
            importingProducts: false,
            adminPassword: "",
            changingAdminPassword: false,
            newProduct: { name: "", price: "" },
            newStore: { name: "", login: "", password: "" },

            get activeProducts() {
                return this.products.filter(product => !product.archived && product.active);
            },
            get inactiveProducts() {
                return this.products.filter(product => !product.archived && !product.active);
            },
            get archivedProducts() {
                return this.products.filter(product => product.archived);
            },
            get activeStores() {
                return this.stores.filter(store => !store.archived);
            },
            get archivedStores() {
                return this.stores.filter(store => store.archived);
            },

            async init() {
                try {
                    await Promise.all([this.refreshProducts(), this.refreshStores()]);
                } catch (error) {
                    this.notify(error.message || "Не вдалося завантажити дані.", "err");
                } finally {
                    this.loading = false;
                }
            },

            notify(message, kind = "ok") {
                this.message = message;
                this.messageKind = kind;
            },

            formatMoney(cents) {
                return (Number(cents || 0) / 100).toFixed(2);
            },

            matchesProduct(product) {
                return normalize(product.editName || product.name).includes(normalize(this.query));
            },

            async importProducts(form) {
                if (this.importingProducts || !form) return;
                const file = form.querySelector('input[type="file"]')?.files?.[0];
                if (!file) {
                    this.notify("Оберіть .xlsx файл для імпорту.", "err");
                    return;
                }
                this.importingProducts = true;
                try {
                    const result = await window.apiRequest("/api/v1/admin/products/import", {
                        method: "POST",
                        body: new FormData(form)
                    });
                    form.reset();
                    await this.refreshProducts();
                    this.notify(result.message || "Імпорт завершено.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося імпортувати Excel-файл.", "err");
                } finally {
                    this.importingProducts = false;
                }
            },

            async changeAdminPassword() {
                if (this.changingAdminPassword) return;
                this.changingAdminPassword = true;
                try {
                    const result = await window.apiRequest("/api/v1/admin/password", {
                        method: "PUT",
                        body: { password: this.adminPassword }
                    });
                    this.adminPassword = "";
                    this.notify(result.message || "Пароль змінено.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося змінити пароль.", "err");
                } finally {
                    this.changingAdminPassword = false;
                }
            },

            async refreshProducts() {
                const products = await window.apiRequest("/api/v1/admin/products");
                this.products = products.map(editProduct);
            },

            async refreshStores() {
                const stores = await window.apiRequest("/api/v1/admin/stores");
                this.stores = stores.map(editStore);
            },

            async createProduct() {
                if (this.creatingProduct) return;
                this.creatingProduct = true;
                try {
                    await window.apiRequest("/api/v1/admin/products", {
                        method: "POST",
                        body: this.newProduct
                    });
                    this.newProduct = { name: "", price: "" };
                    this.newProductOpen = false;
                    await this.refreshProducts();
                    this.notify("Товар додано.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося додати товар.", "err");
                } finally {
                    this.creatingProduct = false;
                }
            },

            async saveProduct(product) {
                if (product.saving) return;
                product.saving = true;
                product.feedback = "";
                try {
                    await window.apiRequest("/api/v1/admin/products/" + product.id, {
                        method: "PUT",
                        body: {
                            name: product.editName,
                            price: product.editPrice,
                            active: Boolean(product.editActive)
                        }
                    });
                    await this.refreshProducts();
                    this.notify("Зміни товару збережено.");
                } catch (error) {
                    product.feedback = error.message || "Не вдалося зберегти товар.";
                    this.notify(product.feedback, "err");
                } finally {
                    product.saving = false;
                }
            },

            async deleteProduct(product) {
                const prompt = product.used_count
                    ? "«" + product.name + "» є у звітах (" + product.used_count + " рядків). Товар буде архівовано, дані звітів залишаться. Продовжити?"
                    : "«" + product.name + "» не використовується у звітах. Видалити остаточно?";
                if (!window.confirm(prompt)) return;
                try {
                    const result = await window.apiRequest("/api/v1/admin/products/" + product.id, { method: "DELETE" });
                    await this.refreshProducts();
                    this.notify(result.message || "Операцію виконано.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося видалити товар.", "err");
                }
            },

            async restoreProduct(product) {
                try {
                    await window.apiRequest("/api/v1/admin/products/" + product.id + "/restore", { method: "POST" });
                    await this.refreshProducts();
                    this.notify("Товар відновлено.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося відновити товар.", "err");
                }
            },

            async createStore() {
                if (this.creatingStore) return;
                this.creatingStore = true;
                try {
                    await window.apiRequest("/api/v1/admin/stores", {
                        method: "POST",
                        body: this.newStore
                    });
                    this.newStore = { name: "", login: "", password: "" };
                    this.newStoreOpen = false;
                    await this.refreshStores();
                    this.notify("Магазин додано.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося додати магазин.", "err");
                } finally {
                    this.creatingStore = false;
                }
            },

            async saveStore(store) {
                if (store.saving) return;
                store.saving = true;
                try {
                    await window.apiRequest("/api/v1/admin/stores/" + store.id, {
                        method: "PUT",
                        body: { name: store.editName, login: store.editLogin }
                    });
                    await this.refreshStores();
                    this.notify("Дані магазину збережено.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося зберегти магазин.", "err");
                } finally {
                    store.saving = false;
                }
            },

            async resetStorePassword(store) {
                if (store.passwordSaving) return;
                store.passwordSaving = true;
                try {
                    const result = await window.apiRequest("/api/v1/admin/stores/" + store.id + "/password", {
                        method: "PUT",
                        body: { password: store.newPassword }
                    });
                    store.newPassword = "";
                    this.notify(result.message || "Пароль змінено.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося змінити пароль.", "err");
                } finally {
                    store.passwordSaving = false;
                }
            },

            async deleteStore(store) {
                const prompt = store.reports_count
                    ? "«" + store.name + "» має звіти (" + store.reports_count + "). Магазин буде архівовано, звіти залишаться. Продовжити?"
                    : "«" + store.name + "» не має звітів. Видалити магазин разом із логіном?";
                if (!window.confirm(prompt)) return;
                try {
                    const result = await window.apiRequest("/api/v1/admin/stores/" + store.id, { method: "DELETE" });
                    await this.refreshStores();
                    this.notify(result.message || "Операцію виконано.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося прибрати магазин.", "err");
                }
            },

            async restoreStore(store) {
                try {
                    await window.apiRequest("/api/v1/admin/stores/" + store.id + "/restore", { method: "POST" });
                    await this.refreshStores();
                    this.notify("Магазин відновлено.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося відновити магазин.", "err");
                }
            }
        };
    };
})();
