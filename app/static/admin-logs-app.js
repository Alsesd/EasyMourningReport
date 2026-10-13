(() => {
    "use strict";
    window.adminLogsApp = () => ({
        login: new URLSearchParams(window.location.search).get("login") || "",
        action: new URLSearchParams(window.location.search).get("action") || "",
        actions: [],
        logs: [],
        loading: true,
        message: "",
        messageKind: "ok",
        async init() {
            try { this.actions = await window.apiRequest("/api/v1/admin/log-actions"); }
            catch (error) { this.message = error.message || "Не вдалося завантажити фільтри."; this.messageKind = "err"; }
            await this.load();
        },
        async load() {
            this.loading = true;
            try {
                const query = new URLSearchParams();
                if (this.login.trim()) query.set("login", this.login.trim());
                if (this.action) query.set("action", this.action);
                query.set("limit", "200");
                this.logs = await window.apiRequest("/api/v1/admin/logs?" + query.toString());
                const url = new URL(window.location.href);
                if (this.login.trim()) url.searchParams.set("login", this.login.trim()); else url.searchParams.delete("login");
                if (this.action) url.searchParams.set("action", this.action); else url.searchParams.delete("action");
                window.history.replaceState({}, "", url);
            } catch (error) { this.message = error.message || "Не вдалося завантажити журнал."; this.messageKind = "err"; }
            finally { this.loading = false; }
        },
        formatTimestamp(value) {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value || "");
            return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0")
                + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
        }
    });
})();
