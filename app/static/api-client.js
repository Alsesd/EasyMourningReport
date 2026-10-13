/* Shared JSON client for the same-origin, cookie-authenticated REST API. */
(() => {
    "use strict";

    window.apiRequest = async function apiRequest(path, options = {}) {
        const { body, headers = {}, ...rest } = options;
        const requestHeaders = { Accept: "application/json", ...headers };
        const request = { credentials: "same-origin", ...rest, headers: requestHeaders };
        if (body !== undefined) {
            if (typeof FormData !== "undefined" && body instanceof FormData) {
                request.body = body;
            } else if (typeof body === "string") {
                request.body = body;
            } else {
                requestHeaders["Content-Type"] = "application/json";
                request.body = JSON.stringify(body);
            }
        }

        const response = await fetch(path, request);
        const contentType = response.headers.get("content-type") || "";
        let result = null;
        if (response.status !== 204) {
            result = contentType.includes("application/json")
                ? await response.json().catch(() => null)
                : await response.text().catch(() => "");
        }
        if (!response.ok) {
            const detail = result && typeof result === "object" ? result.detail : null;
            const message = typeof detail === "string"
                ? detail
                : Array.isArray(detail)
                    ? detail.map(item => item.msg || String(item)).join("; ")
                    : (typeof result === "string" && result) || "Запит не виконано (" + response.status + ").";
            throw new Error(message);
        }
        return result;
    };
})();
