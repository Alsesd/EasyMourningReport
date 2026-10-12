(() => {
    "use strict";

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
                window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
