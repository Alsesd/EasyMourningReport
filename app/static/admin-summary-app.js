(() => {
    "use strict";
    const shiftPeriod = (period, offset) => {
        const [year, month] = period.split("-").map(Number);
        const date = new Date(year, month - 1 + offset, 1);
        return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
    };
    window.adminSummaryApp = (initialPeriod, initialSubmittedOnly) => ({
        period: initialPeriod,
        submittedOnly: Boolean(initialSubmittedOnly),
        summary: null,
        loading: true,
        message: "",
        messageKind: "ok",
        get previousPeriod() { return shiftPeriod(this.period, -1); },
        get nextPeriod() { return shiftPeriod(this.period, 1); },
        get excelUrl() {
            return "/admin/summary.xlsx?period=" + encodeURIComponent(this.period) + (this.submittedOnly ? "&submitted_only=1" : "");
        },
        async init() { await this.load(); },
        async load() {
            this.loading = true;
            try {
                const query = new URLSearchParams({ period: this.period, submitted_only: String(this.submittedOnly) });
                this.summary = await window.apiRequest("/api/v1/admin/summary?" + query.toString());
                const url = new URL(window.location.href);
                url.searchParams.set("period", this.period);
                if (this.submittedOnly) url.searchParams.set("submitted_only", "1");
                else url.searchParams.delete("submitted_only");
                window.history.replaceState({}, "", url);
            } catch (error) { this.message = error.message || "Не вдалося сформувати зведений звіт."; this.messageKind = "err"; }
            finally { this.loading = false; }
        },
        async setPeriod(period) {
            if (!period || period === this.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return;
            this.period = period;
            await this.load();
        },
        formatMoney(cents) { return (Number(cents || 0) / 100).toFixed(2); }
    });
})();
