(() => {
    "use strict";

    const normalize = value => String(value || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase().trim().replace(/\s+/g, " ");

    const centsFromPrice = value => {
        const raw = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
        if (!raw) return NaN;
        const amount = Number(raw);
        return Number.isFinite(amount) && amount >= 0
            ? Math.round((amount + Number.EPSILON) * 100)
            : NaN;
    };

    function editProduct(product) {
        return {
            ...product,
            editName: product.name,
            editPrice: (product.price_cents / 100).toFixed(2),
            editActive: Boolean(product.active),
            priceOpen: false,
            saving: false,
            priceSaving: false,
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
            tailscale: { enabled: false, autostart: false, state: "disabled", public_url: "", login_url: "", error: "" },
            tailscaleAuthKey: "",
            confirmPublic: false,
            tailscaleBusy: false,
            tailscaleAutoStartBusy: false,
            tailscaleRefreshInFlight: false,
            tailscalePoll: null,

            get tailscaleActive() {
                return ["starting", "running", "authentication-required", "stopping"].includes(this.tailscale.state);
            },

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
                try {
                    await this.refreshTailscale();
                } catch (_error) {
                    // The catalogue remains usable even if helper status is unavailable.
                }
                // The status endpoint reads the helper's latest state file. Poll it
                // every two seconds, but never allow slow requests to stack up.
                this.tailscalePoll = window.setInterval(() => {
                    if (document.visibilityState === "visible") {
                        this.refreshTailscale().catch(() => {});
                    }
                }, 2000);
            },

            notify(message, kind = "ok") {
                this.message = message;
                this.messageKind = kind;
            },

            formatMoney(cents) {
                return (Number(cents || 0) / 100).toFixed(2);
            },

            priceCents(value) {
                return centsFromPrice(value);
            },

            hasProductChanges(product) {
                const nameChanged = String(product.editName ?? "").trim() !== product.name;
                const activeChanged = Boolean(product.editActive) !== Boolean(product.active);
                return nameChanged || activeChanged;
            },

            hasPriceChanges(product) {
                const cents = centsFromPrice(product.editPrice);
                return Boolean(product.priceOpen) &&
                    (!Number.isFinite(cents) || cents !== Number(product.price_cents));
            },

            hasStoreChanges(store) {
                return String(store.editName ?? "").trim() !== store.name ||
                    String(store.editLogin ?? "").trim() !== store.login;
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
                if (this.changingAdminPassword || !String(this.adminPassword || "").trim()) return;
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

            async refreshTailscale(force = false) {
                if (this.tailscaleRefreshInFlight ||
                    (!force && (this.tailscaleBusy || this.tailscaleAutoStartBusy))) {
                    return this.tailscale;
                }
                this.tailscaleRefreshInFlight = true;
                try {
                    this.tailscale = await window.apiRequest("/api/v1/admin/tailscale");
                    return this.tailscale;
                } finally {
                    this.tailscaleRefreshInFlight = false;
                }
            },

            async setTailscaleAutostart(enabled) {
                if (this.tailscaleAutoStartBusy) return;
                const previous = Boolean(this.tailscale.autostart);
                this.tailscaleAutoStartBusy = true;
                try {
                    this.tailscale = await window.apiRequest("/api/v1/admin/tailscale/autostart", {
                        method: "PUT",
                        body: { enabled: Boolean(enabled) }
                    });
                    this.notify(this.tailscale.autostart
                        ? "Автозапуск Tailscale увімкнено."
                        : "Автозапуск Tailscale вимкнено.");
                } catch (error) {
                    this.tailscale = { ...this.tailscale, autostart: previous };
                    this.notify(error.message || "Не вдалося змінити автозапуск Tailscale.", "err");
                } finally {
                    this.tailscaleAutoStartBusy = false;
                }
            },

            async startTailscale() {
                if (this.tailscaleBusy) return;
                if (!this.confirmPublic) {
                    this.notify("Підтвердьте публічний доступ перед увімкненням Funnel.", "err");
                    return;
                }
                this.tailscaleBusy = true;
                try {
                    this.tailscale = await window.apiRequest("/api/v1/admin/tailscale", {
                        method: "POST",
                        body: {
                            confirm_public: true,
                            autostart: Boolean(this.tailscale.autostart),
                            auth_key: this.tailscaleAuthKey.trim() || null
                        }
                    });
                    this.tailscaleAuthKey = "";
                    this.notify(this.tailscale.login_url
                        ? "Tailscale очікує авторизацію. Відкрийте посилання нижче."
                        : "Запуск Tailscale Funnel запитано.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося запустити Tailscale Funnel.", "err");
                    await this.refreshTailscale(true).catch(() => {});
                } finally {
                    this.tailscaleBusy = false;
                }
            },

            async stopTailscale() {
                if (this.tailscaleBusy) return;
                this.tailscaleBusy = true;
                try {
                    this.tailscale = await window.apiRequest("/api/v1/admin/tailscale", { method: "DELETE" });
                    this.notify(this.tailscale.autostart
                        ? "Tailscale відключено. Автозапуск залишився увімкненим."
                        : "Tailscale відключено.");
                } catch (error) {
                    this.notify(error.message || "Не вдалося вимкнути Tailscale Funnel.", "err");
                } finally {
                    this.tailscaleBusy = false;
                }
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
                if (product.saving || !this.hasProductChanges(product)) return;
                product.saving = true;
                product.feedback = "";
                const keepPriceOpen = product.priceOpen;
                const keepEditPrice = product.editPrice;
                try {
                    const updated = await window.apiRequest("/api/v1/admin/products/" + product.id, {
                        method: "PUT",
                        body: {
                            name: product.editName,
                            price: this.formatMoney(product.price_cents),
                            active: Boolean(product.editActive)
                        }
                    });
                    Object.assign(product, editProduct(updated), {
                        priceOpen: keepPriceOpen,
                        editPrice: keepPriceOpen ? keepEditPrice : this.formatMoney(updated.price_cents)
                    });
                    this.notify("Зміни товару збережено.");
                } catch (error) {
                    product.feedback = error.message || "Не вдалося зберегти товар.";
                    this.notify(product.feedback, "err");
                } finally {
                    product.saving = false;
                }
            },

            async savePrice(product) {
                if (product.priceSaving || product.saving || !product.priceOpen) return;
                const cents = centsFromPrice(product.editPrice);
                if (!Number.isFinite(cents) || cents < 0) {
                    product.feedback = "Введіть коректну невід’ємну ціну.";
                    this.notify(product.feedback, "err");
                    return;
                }
                if (cents === Number(product.price_cents)) {
                    product.feedback = "";
                    return;
                }

                // Price, name, and activation are independent edits. Keep the two
                // unsaved product drafts when the server returns the saved price DTO.
                const draftName = product.editName;
                const draftActive = product.editActive;
                const editorWasOpen = product.priceOpen;
                const productWasSaving = product.saving;
                product.priceSaving = true;
                product.feedback = "";
                try {
                    const updated = await window.apiRequest(
                        "/api/v1/admin/products/" + product.id + "/price",
                        { method: "PUT", body: { price: product.editPrice } }
                    );
                    Object.assign(product, editProduct(updated), {
                        priceOpen: editorWasOpen,
                        editName: draftName,
                        editActive: draftActive,
                        saving: productWasSaving,
                        priceSaving: true
                    });
                    product.feedback = "Ціну збережено. Історію за цей місяць оновлено.";
                    this.notify(product.feedback);
                } catch (error) {
                    product.feedback = error.message || "Не вдалося зберегти ціну.";
                    this.notify(product.feedback, "err");
                } finally {
                    product.priceSaving = false;
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
                if (store.saving || !this.hasStoreChanges(store)) return;
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
