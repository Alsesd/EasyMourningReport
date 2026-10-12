(() => {
    "use strict";

    // Persist a manual light/dark choice; storage is optional and failures are harmless.
    const themeButton = document.getElementById("theme-toggle");
    const root = document.documentElement;
    function applyTheme(theme) {
        root.dataset.theme = theme;
        document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", theme === "light" ? "#f2f5f8" : "#101722"));
        if (themeButton) {
            const light = theme === "light";
            themeButton.textContent = light ? "☾ Темна тема" : "☼ Світла тема";
            themeButton.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
            themeButton.setAttribute("aria-pressed", String(light));
        }
    }
    let storedTheme = "";
    try { storedTheme = localStorage.getItem("easyMourningReport.theme") || ""; } catch (_error) { }
    applyTheme(storedTheme === "light" ? "light" : "dark");
    themeButton?.addEventListener("click", () => {
        const next = root.dataset.theme === "light" ? "dark" : "light";
        applyTheme(next);
        try { localStorage.setItem("easyMourningReport.theme", next); } catch (_error) { }
    });


    });
    document.addEventListener("fullscreenchange", syncFullscreenButton);
    syncFullscreenButton();

    // Preserve the user's viewport after ordinary POST/redirect forms (e.g. store edits).
    const scrollKey = "easyMourningReport.restoreScrollY";
    try {
        const savedY = sessionStorage.getItem(scrollKey);
        if (savedY !== null) {
            sessionStorage.removeItem(scrollKey);
            requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, Number(savedY) || 0)));
        }
    } catch (_error) { /* Scroll restoration is an enhancement only. */ }
    document.addEventListener("submit", event => {
        const form = event.target;
        if (!form || !form.matches || !form.matches("form")) return;
        if (form.matches("form.product-form")) return; // AJAX save already keeps the viewport.
        try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch (_error) { }
    }, true);

    // The creator mark stays discreet until deliberately tapped or focused.
    const makerMark = document.querySelector(".maker-mark");
    const makerButton = makerMark?.querySelector(".maker-mark-trigger");
    makerButton?.addEventListener("click", () => {
        const revealed = makerMark.classList.toggle("is-revealed");
        makerButton.setAttribute("aria-expanded", String(revealed));
        makerButton.setAttribute("aria-label", revealed ? "Hide creator credit" : "Reveal creator credit");
    });
    document.addEventListener("click", event => {
        if (makerMark && !makerMark.contains(event.target)) {
            makerMark.classList.remove("is-revealed");
            makerButton?.setAttribute("aria-expanded", "false");
        }
    });

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/sw.js").catch(() => {
                // Offline support is progressive enhancement.
            });
        });
    }

    let installPrompt;
    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();
        installPrompt = event;
        const button = document.getElementById("install");
        if (button) button.hidden = false;
    });

    document.addEventListener("click", event => {
        if (event.target?.id === "install" && installPrompt) {
            installPrompt.prompt();
            installPrompt = null;
            event.target.hidden = true;
        }
    });

    document.querySelectorAll(".flash:not(.err)").forEach(message => {
        window.setTimeout(() => message.remove(), 9000);
    });

    document.addEventListener("submit", event => {
        const message = event.target?.dataset?.confirm;
        if (message && !window.confirm(message)) event.preventDefault();
    });

    // Smooth, partial navigation between the fixed bottom tabs.
    const tabLinks = [...document.querySelectorAll(".tabs a")];
    const main = document.querySelector("main");
    if (main && tabLinks.length) {
        const navigateTab = async link => {
            if (link.origin !== location.origin || link.pathname === location.pathname && link.search === location.search) return;
            main.classList.add("page-leaving");
            try {
                const response = await fetch(link.href, { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } });
                if (!response.ok) throw new Error("Navigation failed");
                const markup = await response.text();
                const nextDoc = new DOMParser().parseFromString(markup, "text/html");
                const nextMain = nextDoc.querySelector("main");
                if (!nextMain) throw new Error("Page content missing");
                const currentMain = document.querySelector("main");
                currentMain.replaceChildren(...nextMain.childNodes);
                document.title = nextDoc.title || document.title;
                history.pushState({}, "", link.href);
                document.querySelectorAll(".tabs a").forEach(tab => {
                    const active = tab.pathname === location.pathname;
                    if (active) tab.setAttribute("aria-current", "page");
                    else tab.removeAttribute("aria-current");
                });
                // Keep the viewport steady across tab swaps; users can scroll intentionally.
                document.dispatchEvent(new CustomEvent("app:page-updated"));
            } catch (_error) {
                location.href = link.href;
            } finally {
                document.querySelector("main")?.classList.remove("page-leaving");
            }
        };
        document.addEventListener("click", event => {
            const link = event.target.closest(".tabs a");
            if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigateTab(link);
        });
        window.addEventListener("popstate", () => location.reload());
    }
})();
