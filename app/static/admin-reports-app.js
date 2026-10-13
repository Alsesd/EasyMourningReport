(() => {
    "use strict";
    function syncPeriodLinks(period) {
        document.querySelectorAll('.tabs a[href*="period="]').forEach(link => {
            const url = new URL(link.href, window.location.origin);
            url.searchParams.set("period", period);
            link.href = url.pathname + url.search + url.hash;
        });
    }
    const shiftPeriod = (period, offset) => {
        const [year, month] = period.split("-").map(Number);
        const date = new Date(year, month - 1 + offset, 1);
        return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
    };
    window.adminReportsApp = initialPeriod => ({
        period: initialPeriod,
        rows: [],
        loading: true,
        message: "",
        messageKind: "ok",
        get previousPeriod() { return shiftPeriod(this.period, -1); },
        get nextPeriod() { return shiftPeriod(this.period, 1); },
        async init() { await this.load(); },
        async load() {
            this.loading = true;
            try {
                this.rows = await window.apiRequest("/api/v1/admin/reports?period=" + encodeURIComponent(this.period));
                const url = new URL(window.location.href);
                url.searchParams.set("period", this.period);
                window.history.replaceState({}, "", url);
                syncPeriodLinks(this.period);
            } catch (error) {
                this.message = error.message || "Не вдалося завантажити звіти.";
                this.messageKind = "err";
            } finally { this.loading = false; }
        },
        async setPeriod(period) {
            if (!period || period === this.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return;
            this.period = period;
            await this.load();
        },
        formatMoney(cents) { return (Number(cents || 0) / 100).toFixed(2); },
        statusLabel(status) {
            return status === "submitted" ? "Надіслано" : status === "draft" ? "Чернетка" : "Немає звіту";
        },
        statusClass(status) { return status === "submitted" ? "ok" : status === "draft" ? "warn" : ""; }
    });
})();
