(() => {
    "use strict";
    window.adminReportDetailApp = reportId => ({
        reportId,
        report: null,
        loading: true,
        saving: false,
        message: "",
        messageKind: "ok",
        get displayLines() {
            if (!this.report) return [];
            return this.report.rows.flatMap(row => row.inputs
                .filter(input => input.quantity || row.repriced)
                .map(input => ({ name: row.name, ...input })));
        },
        async init() { await this.load(); },
        async load() {
            this.loading = true;
            try { this.report = await window.apiRequest("/api/v1/admin/reports/" + this.reportId); }
            catch (error) { this.message = error.message || "Не вдалося завантажити звіт."; this.messageKind = "err"; }
            finally { this.loading = false; }
        },
        notify(message, kind = "ok") { this.message = message; this.messageKind = kind; },
        formatMoney(cents) { return (Number(cents || 0) / 100).toFixed(2); },
        statusLabel(status) { return status === "submitted" ? "Надіслано" : "Чернетка"; },
        statusClass(status) { return status === "submitted" ? "ok" : "warn"; },
        priceLabel(label) { return label === "old" ? "стара ціна" : label === "new" ? "нова ціна" : label === "saved" ? "раніше збережена" : ""; },
        priceTagClass(label) { return label === "old" ? "old" : label === "new" ? "new" : label === "saved" ? "saved" : ""; },
        async toggleLock() {
            if (!this.report || this.saving) return;
            const target = this.report.status === "submitted" ? "draft" : "submitted";
            if (target === "submitted" && !window.confirm("Заблокувати звіт? Магазин не зможе його змінити, поки ви не розблокуєте.")) return;
            this.saving = true;
            try {
                await window.apiRequest("/api/v1/admin/reports/" + this.reportId, {
                    method: "PATCH", body: { status: target }
                });
                await this.load();
                this.notify(target === "submitted" ? "Звіт заблоковано." : "Звіт розблоковано.");
            } catch (error) { this.notify(error.message || "Не вдалося змінити статус звіту.", "err"); }
            finally { this.saving = false; }
        }
    });
})();
