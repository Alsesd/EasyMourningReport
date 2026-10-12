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
})();
