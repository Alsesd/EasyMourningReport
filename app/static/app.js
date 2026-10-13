(() => {
    "use strict";

    // Persist a manual light/dark choice; storage is optional and failures are harmless.
    const themeButton = document.getElementById("theme-toggle");
    const appearanceMenu = themeButton?.closest(".appearance-menu");
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
        appearanceMenu?.removeAttribute("open");
    });
    document.addEventListener("click", event => {
        if (appearanceMenu && !appearanceMenu.contains(event.target)) appearanceMenu.removeAttribute("open");
    });


    // Clicking the already active navigation tab should be a no-op, not a full reload.
    document.querySelectorAll(".tabs a[aria-current='page']").forEach(link => {
        link.addEventListener("click", event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
        });
    });

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

})();
