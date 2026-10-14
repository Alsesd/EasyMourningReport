(() => {
    "use strict";

    window.storeReportApp = function storeReportApp(initialPeriod) {
        return {
            period: initialPeriod,
            report: null,
            rows: [],
            loading: true,
            saving: false,
            message: "",
            messageKind: "ok",
            savedSnapshot: "",
            beforeUnloadHandler: null,

            async init() {
                const state = this;
                this.beforeUnloadHandler = event => {
                    if (state.dirty && !state.saving && state.report && !state.report.read_only) {
                        event.preventDefault();
                        event.returnValue = "";
                    }
                };
                window.addEventListener("beforeunload", this.beforeUnloadHandler);
                await this.load();
            },

            async load() {
                this.loading = true;
                try {
                    const report = await window.apiRequest("/api/v1/store/reports/" + encodeURIComponent(this.period));
                    this.report = report;
                    this.rows = report.rows.map(row => ({
                        ...row,
                        inputs: row.inputs.map(input => ({ ...input, quantity: Number(input.quantity) || 0 }))
                    }));
                    this.savedSnapshot = this.snapshot();
                } catch (error) {
                    this.notify(error.message || "Не вдалося завантажити звіт.", "err");
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

            priceLabel(label) {
                if (label === "old") return " · стара ціна";
                if (label === "new") return " · нова ціна";
                if (label === "saved") return " · раніше збережена";
                return "";
            },

            get statusLabel() {
                if (!this.report) return "";
                if (this.report.status === "submitted") return "Надіслано";
                if (this.report.status === "draft") return "Чернетка";
                return "Новий";
            },

            get previousPeriod() {
                const months = this.report ? this.report.available_periods : [];
                const index = months.indexOf(this.period);
                return index > 0 ? months[index - 1] : null;
            },

            get nextPeriod() {
                const months = this.report ? this.report.available_periods : [];
                const index = months.indexOf(this.period);
                return index >= 0 && index < months.length - 1 ? months[index + 1] : null;
            },

            get totalCents() {
                const editable = this.rows.reduce((total, row) => total + row.inputs.reduce(
                    (sum, input) => sum + Math.max(0, Number(input.quantity) || 0) * input.price_cents,
                    0
                ), 0);
                return editable + (this.report ? this.report.inactive_total_cents : 0);
            },

            snapshot() {
                return JSON.stringify(this.rows.map(row => ({
                    id: row.id,
                    quantities: row.inputs.map(input => [input.price_cents, Number(input.quantity) || 0])
                })));
            },

            get dirty() {
                return Boolean(this.report && !this.report.read_only && this.snapshot() !== this.savedSnapshot);
            },

            async save(action) {
                if (this.saving || !this.report || this.report.read_only) return;
                if (action === "submit" && !window.confirm(
                    "Надіслати звіт за " + this.period + "? Після цього змінити його зможе лише адміністратор, розблокувавши звіт."
                )) return;

                this.saving = true;
                try {
                    const payload = {
                        action,
                        quantities: this.rows.flatMap(row => row.inputs.map(input => ({
                            product_id: row.id,
                            price_cents: input.price_cents,
                            quantity: Math.max(0, Number(input.quantity) || 0)
                        })))
                    };
                    const result = await window.apiRequest("/api/v1/store/reports/" + encodeURIComponent(this.period), {
                        method: "PUT",
                        body: payload
                    });
                    this.report = result;
                    this.rows = result.rows.map(row => ({
                        ...row,
                        inputs: row.inputs.map(input => ({ ...input, quantity: Number(input.quantity) || 0 }))
                    }));
                    this.savedSnapshot = this.snapshot();
                    this.notify(action === "submit"
                        ? "Звіт надіслано й заблоковано. Розблокувати його може лише адміністратор."
                        : "Чернетку збережено.", "ok");
                } catch (error) {
                    this.notify(error.message || "Не вдалося зберегти звіт.", "err");
                } finally {
                    this.saving = false;
                }
            }
        };
    };
})();
